import { useEffect, useMemo, useRef, useState } from "react";
import { buildSheetPreview, type PreviewBox, type SheetPreview } from "../../modules/excel-template/engine/sheetPreview";
import { base64ToUint8Array } from "../../modules/excel-template/templateStorage";

/** Nhóm vùng trên phiếu, mỗi nhóm một màu: ô tự điền, ảnh, chữ ký, ô nhập thêm, vùng in. */
export type PreviewTone = "field" | "image" | "signer" | "custom" | "print";
/** Một vùng cần chỉ trên ảnh: theo vùng ô (range) hoặc theo các ô có mã {{placeholder}}. */
export type PreviewRegion = { id: string; label: string; tone: PreviewTone; range?: string; placeholder?: string };

export const PREVIEW_TONE_LABELS: Readonly<Record<PreviewTone, string>> = {
  field: "Tự điền từ hồ sơ",
  image: "Ảnh nhân sự",
  signer: "Chữ ký người ký",
  custom: "Ô nhập thêm",
  print: "Vùng in",
};

/**
 * Ảnh xem trước của phiếu Excel mẫu (vẽ lại từ chính file: cột, dòng, ô gộp, viền, màu, chữ, logo) với các vùng được
 * tô màu theo cấu hình. Vùng `active` sáng hẳn lên kèm nhãn; bấm vào một vùng thì báo `onPick` để nhảy tới mục cấu hình.
 */
export function TemplatePreview(props: { fileBase64: string; sheetName: string; printArea: string; regions: readonly PreviewRegion[]; active: string | null; onPick: (id: string) => void }) {
  const { fileBase64, sheetName, printArea, regions, active, onPick } = props;
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

  // Vùng đang chọn: cuộn tới cho thấy
  useEffect(() => {
    if (!active) return;
    frameRef.current?.querySelector(`[data-region="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, boxes]);

  const scale = preview && width ? width / preview.width : 1;
  const missing = active && preview && !boxes.some((item) => item.region.id === active) ? regions.find((region) => region.id === active) : null;
  return (
    <div className="template-preview">
      <div className="template-preview-legend">
        {(Object.keys(PREVIEW_TONE_LABELS) as PreviewTone[]).map((tone) => <span key={tone} className={`tone-${tone}`}><i />{PREVIEW_TONE_LABELS[tone]}</span>)}
      </div>
      {missing && <p className="template-preview-note">“{missing.label}” chưa có vị trí trên phiếu (chưa nhập ô, hoặc nằm ngoài vùng in).</p>}
      <div className="template-preview-frame" ref={frameRef}>
        {failed && <p className="muted">Không vẽ được bản xem trước của file này.</p>}
        {!preview && !failed && <p className="muted">Đang dựng bản xem trước…</p>}
        {preview && (
          <div className="template-preview-scaler" style={{ height: preview.height * scale }}>
            <div className="template-preview-sheet" style={{ width: preview.width, height: preview.height, transform: `scale(${scale})` }}>
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
              {boxes.map(({ region, box }, index) => (
                <button
                  type="button"
                  key={`${region.id}-${index}`}
                  data-region={region.id}
                  className={`preview-region tone-${region.tone}${region.id === active ? " is-active" : ""}${active && region.id !== active ? " is-dim" : ""}`}
                  style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                  title={region.label}
                  onClick={() => onPick(region.id)}
                >
                  {region.id === active && <span className="preview-region-label" style={{ transform: `scale(${1 / scale})` }}>{region.label}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
