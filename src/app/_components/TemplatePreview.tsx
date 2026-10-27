import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { buildSheetPreview, type PreviewBox, type SheetPreview } from "../../modules/excel-template/engine/sheetPreview";
import { base64ToUint8Array } from "../../modules/excel-template/templateStorage";

/** Nhóm vùng trên phiếu, mỗi nhóm một màu: ô tự điền, ảnh, chữ ký, ô nhập thêm, vùng in. */
export type PreviewTone = "field" | "image" | "signer" | "custom" | "print";
/** Một vùng cần chỉ trên ảnh: theo vùng ô (range) hoặc theo các ô có mã {{placeholder}}. */
export type PreviewRegion = { id: string; label: string; tone: PreviewTone; range?: string; placeholder?: string };

/** Vùng ô vừa chọn trên ảnh: địa chỉ, chữ đang có ở ô đầu, các vùng cấu hình chạm vào. */
export type PreviewSelection = { range: string; text: string; regionIds: string[] };

export const PREVIEW_TONE_LABELS: Readonly<Record<PreviewTone, string>> = {
  field: "Tự điền từ hồ sơ",
  image: "Ảnh nhân sự",
  signer: "Chữ ký người ký",
  custom: "Ô nhập thêm",
  print: "Vùng in",
};

/**
 * Ảnh xem trước của phiếu Excel mẫu (vẽ lại từ chính file: cột, dòng, ô gộp, viền, màu, chữ, logo) với các vùng được
 * tô màu theo cấu hình. Vùng `active` sáng hẳn lên kèm nhãn. Bấm hoặc kéo chuột trên ảnh để chọn ô / vùng ô → `onSelect`.
 */
export function TemplatePreview(props: { fileBase64: string; sheetName: string; printArea: string; regions: readonly PreviewRegion[]; active: string | null; selection?: string | null; onSelect?: (selection: PreviewSelection) => void; overlay?: ReactNode }) {
  const { fileBase64, sheetName, printArea, regions, active, onSelect } = props;
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    if (!fileBase64) return () => { alive = false; };
    buildSheetPreview(base64ToUint8Array(fileBase64), sheetName, printArea)
      .then((next) => { if (alive) { setPreview(next); setFailed(!next); } }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [fileBase64, sheetName, printArea]);

  // Co ảnh theo bề ngang khung
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const boxes = useMemo(() => {
    if (!preview) return [] as { region: PreviewRegion; box: PreviewBox }[];
    return regions.flatMap((region) => {
      if (region.range) {
        const box = preview.boxOf(region.range);
        return box ? [{ region, box }] : [];
      }
      if (region.placeholder) return preview.cells.filter((cell) => cell.placeholders.includes(region.placeholder!)).map((cell) => ({ region, box: cell as PreviewBox }));
      return [];
    });
  }, [preview, regions]);

  // Vùng đang chọn nằm ngoài khung: chỉ cuộn trong khung ảnh, không cuộn cả trang (cuộn trang làm chuột rơi sang mục khác → nháy liên tục)
  useEffect(() => {
    const frame = frameRef.current;
    const target = active ? frame?.querySelector<HTMLElement>(`[data-region="${CSS.escape(active)}"]`) : null;
    if (!frame || !target) return;
    const view = frame.getBoundingClientRect(), box = target.getBoundingClientRect();
    if (box.top < view.top) frame.scrollBy({ top: box.top - view.top - 24, behavior: "smooth" });
    else if (box.bottom > view.bottom) frame.scrollBy({ top: Math.min(box.bottom - view.bottom + 24, box.top - view.top - 24), behavior: "smooth" });
  }, [active, boxes]);

  // Phần phiếu (hàng trăm ô) chỉ vẽ lại khi đổi file/vùng in, không vẽ lại mỗi lần rê chuột
  const sheet = useMemo(() => preview && (
    <>
      {preview.cells.map((cell) => (
        <div key={cell.address} className="preview-cell" style={{
          left: cell.x, top: cell.y, width: cell.width, height: cell.height,
          background: cell.fill ?? undefined, color: cell.color ?? undefined,
          fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? "italic" : undefined, fontSize: cell.fontSize,
          justifyContent: cell.align === "center" ? "center" : cell.align === "right" ? "flex-end" : "flex-start",
          alignItems: cell.valign === "top" ? "flex-start" : cell.valign === "middle" ? "center" : "flex-end",
          textAlign: cell.align, whiteSpace: cell.wrap ? "pre-wrap" : "pre",
          borderTopWidth: cell.border[0] ? 1 : 0, borderRightWidth: cell.border[1] ? 1 : 0, borderBottomWidth: cell.border[2] ? 1 : 0, borderLeftWidth: cell.border[3] ? 1 : 0,
        }}>{cell.text}</div>
      ))}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview.images.map((image, index) => <img key={index} className="preview-image" src={image.src} alt="" style={{ left: image.x, top: image.y, width: image.width, height: image.height }} />)}
    </>
  ), [preview]);

  const scale = preview && width ? width / preview.width : 1;

  // Chọn ô: bấm một ô hoặc kéo chuột qua nhiều ô (tọa độ đổi về pixel của phiếu trước khi thu nhỏ)
  const pointOf = (event: PointerEvent) => {
    const rect = sheetRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSelect || !preview || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = pointOf(event);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  };
  const moveDrag = (event: PointerEvent) => { if (drag) { const { x, y } = pointOf(event); setDrag({ ...drag, x1: x, y1: y }); } };
  const endDrag = () => {
    if (!drag || !preview || !onSelect) return;
    setDrag(null);
    const range = preview.rangeAt(drag.x0, drag.y0, drag.x1, drag.y1);
    const area = preview.boxOf(range);
    const first = range.split(":")[0];
    const touches = (box: PreviewBox) => Boolean(area) && box.x < area!.x + area!.width && box.x + box.width > area!.x && box.y < area!.y + area!.height && box.y + box.height > area!.y;
    const regionIds = [...new Set(boxes.filter(({ region, box }) => region.tone !== "print" && touches(box)).map(({ region }) => region.id))];
    onSelect({ range, text: preview.cells.find((cell) => cell.address === first)?.text ?? "", regionIds });
  };
  const [overlayAtTop, setOverlayAtTop] = useState(false);
  useEffect(() => {
    const frame = frameRef.current;
    const box = props.selection && preview ? preview.boxOf(props.selection) : null;
    if (frame && box) setOverlayAtTop((box.y + box.height / 2) * scale - frame.scrollTop > frame.clientHeight / 2);
  }, [props.selection, preview, scale]);
  const selectionBox = preview ? (drag ? preview.boxOf(preview.rangeAt(drag.x0, drag.y0, drag.x1, drag.y1)) : props.selection ? preview.boxOf(props.selection) : null) : null;
  const missing = active && preview && !boxes.some((item) => item.region.id === active) ? regions.find((region) => region.id === active) : null;
  return (
    <div className="template-preview">
      <div className="template-preview-legend">
        {(Object.keys(PREVIEW_TONE_LABELS) as PreviewTone[]).map((tone) => <span key={tone} className={`tone-${tone}`}><i />{PREVIEW_TONE_LABELS[tone]}</span>)}
      </div>
      {/* Luôn giữ chỗ cho dòng nhắc để ảnh phiếu không bị đẩy lên xuống khi rê chuột */}
      <p className="template-preview-note" style={{ visibility: missing ? "visible" : "hidden" }}>{missing ? `“${missing.label}” chưa có vị trí trên phiếu (chưa nhập ô, hoặc nằm ngoài vùng in).` : " "}</p>
      <div className="template-preview-body">
      {/* Bảng gán dữ liệu nổi trên ảnh, ở nửa không có ô đang chọn: ảnh không bị đẩy xuống, ô vừa bấm không bị che */}
      {props.overlay && <div className={`template-preview-overlay ${overlayAtTop ? "at-top" : "at-bottom"}`}>{props.overlay}</div>}
      <div className="template-preview-frame" ref={frameRef}>
        {failed && <p className="muted">Không vẽ được bản xem trước của file này.</p>}
        {!preview && !failed && <p className="muted">Đang dựng bản xem trước…</p>}
        {preview && (
          <div className="template-preview-scaler" style={{ height: preview.height * scale }}>
            <div
              className={`template-preview-sheet${onSelect ? " is-selectable" : ""}`}
              ref={sheetRef}
              style={{ width: preview.width, height: preview.height, transform: `scale(${scale})` }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
            >
              {sheet}
              {boxes.map(({ region, box }, index) => (
                <div
                  key={`${region.id}-${index}`}
                  data-region={region.id}
                  className={`preview-region tone-${region.tone}${region.id === active ? " is-active" : ""}${active && region.id !== active ? " is-dim" : ""}`}
                  style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                  title={region.label}
                >
                  {region.id === active && <span className="preview-region-label" style={{ transform: `scale(${1 / scale})` }}>{region.label}</span>}
                </div>
              ))}
              {selectionBox && <div className="preview-selection" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
