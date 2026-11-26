"use client";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Circle, Square, Trash2, Undo2 } from "lucide-react";
import { MARK_COLOR, markFromDrag, type MarkShape, type PhotoMark } from "../../../modules/inspections/types";

/** Nét khoanh vẽ bằng SVG phủ lên ảnh (tọa độ 0..1 → viewBox 0..100). */
export function MarkLayer(props: { marks: readonly PhotoMark[]; preview?: PhotoMark | null }) {
  const all = props.preview ? [...props.marks, props.preview] : props.marks;
  return (
    <svg className="pm-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {all.map((mark, index) => mark.shape === "circle"
        ? <ellipse key={index} cx={(mark.x + mark.w / 2) * 100} cy={(mark.y + mark.h / 2) * 100} rx={(mark.w / 2) * 100} ry={(mark.h / 2) * 100} fill="none" stroke={mark.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        : <rect key={index} x={mark.x * 100} y={mark.y * 100} width={mark.w * 100} height={mark.h * 100} fill="none" stroke={mark.color ?? MARK_COLOR} strokeWidth={3} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

/** Ảnh kèm nét khoanh (chỉ xem). */
export function MarkedPhoto(props: { url: string | null | undefined; marks: readonly PhotoMark[]; alt: string; onClick?: (() => void) | undefined }) {
  if (!props.url) return <div className="pm-empty">Chưa có ảnh</div>;
  return (
    <button type="button" className="pm-photo" onClick={props.onClick} disabled={!props.onClick} aria-label={props.alt}>
      <img src={props.url} alt={props.alt} />
      <MarkLayer marks={props.marks} />
    </button>
  );
}

/**
 * Vẽ hình tròn hoặc ô vuông lên ảnh để nhấn mạnh điểm lỗi: chọn công cụ rồi kéo trên ảnh (chuột hoặc ngón tay).
 * Hoàn tác nét cuối, xóa hết; trả nét về qua onChange.
 */
export function PhotoMarker(props: { url: string; marks: readonly PhotoMark[]; onChange: (marks: PhotoMark[]) => void }) {
  const [shape, setShape] = useState<MarkShape>("circle");
  const [preview, setPreview] = useState<PhotoMark | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const point = (event: ReactPointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  return (
    <div className="pm">
      <div className="pm-tools" role="toolbar" aria-label="Công cụ khoanh">
        <button type="button" className={`button${shape === "circle" ? " primary" : ""}`} aria-pressed={shape === "circle"} onClick={() => setShape("circle")}><Circle size={15} aria-hidden="true" /> Khoanh tròn</button>
        <button type="button" className={`button${shape === "rect" ? " primary" : ""}`} aria-pressed={shape === "rect"} onClick={() => setShape("rect")}><Square size={15} aria-hidden="true" /> Ô vuông</button>
        <button type="button" className="button" disabled={!props.marks.length} onClick={() => props.onChange(props.marks.slice(0, -1))}><Undo2 size={15} aria-hidden="true" /> Hoàn tác</button>
        <button type="button" className="button" disabled={!props.marks.length} onClick={() => props.onChange([])}><Trash2 size={15} aria-hidden="true" /> Xóa nét</button>
        <small className="muted">Kéo trên ảnh để vẽ.</small>
      </div>
      <div ref={box} className="pm-canvas" style={{ touchAction: "none" }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); }}
        onPointerMove={(event) => { if (start.current) setPreview(markFromDrag(shape, start.current, point(event))); }}
        onPointerUp={(event) => { const from = start.current; start.current = null; setPreview(null); if (!from) return; const mark = markFromDrag(shape, from, point(event)); if (mark) props.onChange([...props.marks, mark]); }}
        onPointerCancel={() => { start.current = null; setPreview(null); }}>
        <img src={props.url} alt="Ảnh để khoanh" draggable={false} />
        <MarkLayer marks={props.marks} preview={preview} />
      </div>
    </div>
  );
}

/** Ảnh có nét khoanh "in" vào ảnh (để xuất Excel / PowerPoint). */
export async function burnMarks(image: Blob, marks: readonly PhotoMark[], maxSide = 1200): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  ctx.lineWidth = Math.max(3, Math.round(Math.max(width, height) / 200));
  for (const mark of marks) {
    ctx.strokeStyle = mark.color ?? MARK_COLOR;
    ctx.beginPath();
    if (mark.shape === "circle") ctx.ellipse((mark.x + mark.w / 2) * width, (mark.y + mark.h / 2) * height, (mark.w / 2) * width, (mark.h / 2) * height, 0, 0, Math.PI * 2);
    else ctx.rect(mark.x * width, mark.y * height, mark.w * width, mark.h * height);
    ctx.stroke();
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không vẽ được ảnh.")), "image/jpeg", 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
