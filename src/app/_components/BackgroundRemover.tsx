import { useEffect, useState, type DragEvent } from "react";
import { Download, ImagePlus } from "lucide-react";
import { toTransparentPng } from "../../lib/image/toTransparentPng";

type Result = { original: string; cleaned: string; file: File };

/**
 * Khung tách nền dùng chung (trang Công cụ, thư viện chữ ký, chữ ký nhân viên): chọn / kéo thả ảnh chụp chữ ký, mộc
 * → xem ảnh gốc cạnh ảnh đã tách nền → trả về PNG nền trong suốt đã cắt sát nét mực.
 */
export function BackgroundRemover(props: {
  /** Chiều ngang tối đa của PNG kết quả. */
  maxWidth: number;
  /** Ảnh đang dùng (khi sửa), hiện khi chưa chọn ảnh mới. */
  currentImage?: string | null | undefined;
  onChange?: (png: File) => void;
  /** Có thì hiện nút Xóa ảnh. */
  onRemove?: () => void;
  onBusyChange?: (busy: boolean) => void;
  downloadable?: boolean;
  compact?: boolean;
}) {
  const { onBusyChange } = props;
  const [result, setResult] = useState<Result | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (result) { URL.revokeObjectURL(result.original); URL.revokeObjectURL(result.cleaned); } }, [result]);
  useEffect(() => { onBusyChange?.(processing); }, [processing, onBusyChange]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Hãy chọn ảnh JPG, PNG hoặc WebP."); return; }
    setError("");
    setProcessing(true);
    try {
      const png = await toTransparentPng(file, props.maxWidth);
      setResult({ original: URL.createObjectURL(file), cleaned: URL.createObjectURL(png), file: png });
      props.onChange?.(png);
    } catch { setError("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); }
    finally { setProcessing(false); }
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  };

  const remove = () => { setResult(null); props.onRemove?.(); };
  const hasImage = Boolean(result || props.currentImage);
  return (
    <div className={props.compact ? "bg-remover compact" : "bg-remover"}>
      <label className={dragging ? "tool-drop dragging" : "tool-drop"} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <ImagePlus size={22} aria-hidden="true" />
        <b>{processing ? "Đang tách nền…" : hasImage ? "Chọn hoặc kéo thả ảnh khác" : "Chọn hoặc kéo thả ảnh vào đây"}</b>
        <span className="muted">Chụp chữ ký (kèm mộc nếu có) trên giấy, thẳng, đủ sáng, chừa lề xung quanh. Nền, bóng đổ được tách tự động.</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={processing} onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result ? (
        <div className="tool-compare">
          <figure>
            <figcaption>Ảnh gốc</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="tool-stage"><img src={result.original} alt="Ảnh gốc" /></div>
          </figure>
          <figure>
            <figcaption>Đã tách nền</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="tool-stage checkerboard"><img src={result.cleaned} alt="Ảnh đã tách nền" /></div>
          </figure>
        </div>
      ) : props.currentImage ? (
        <figure className="bg-remover-current">
          <figcaption>Ảnh đang dùng</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="tool-stage checkerboard"><img src={props.currentImage} alt="Ảnh đang dùng" /></div>
        </figure>
      ) : null}
      {(props.downloadable && result) || (props.onRemove && hasImage) ? (
        <div className="button-row">
          {props.downloadable && result && <a className="button primary" href={result.cleaned} download={result.file.name}><Download className="ico" size={16} aria-hidden="true" /> Tải ảnh PNG</a>}
          {props.onRemove && hasImage && <button type="button" className="button danger" onClick={remove}>Xóa ảnh</button>}
        </div>
      ) : null}
    </div>
  );
}
