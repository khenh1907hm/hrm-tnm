import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { removeWhiteBackground } from "../../lib/image/removeWhiteBackground";
import { randomIds } from "../../lib/ids";
import type { Actor } from "../../modules/auth/permissions";
import type { Signature } from "../../modules/signatures/types";
import { issueText, type App, type SetNotice } from "./shared";

/** Ảnh chụp chữ ký trên giấy trắng → PNG nền trong suốt (xử lý ngay trong trình duyệt). */
async function toTransparentPng(upload: File): Promise<File> {
  const bitmap = await createImageBitmap(upload);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể xử lý ảnh chữ ký.");
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(removeWhiteBackground({ data: pixels.data, width: pixels.width, height: pixels.height }).data);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh chữ ký PNG.")), "image/png"));
  return new File([blob], `${upload.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
}

/** Thêm mới hoặc sửa chữ ký: tên, chức danh, ảnh (khi sửa có thể giữ ảnh cũ). */
export function SignatureFormModal(props: { app: App; actor: Actor; editing?: Signature | null; currentImageUrl?: string | undefined; onClose: () => void; onSaved: (signature: Signature, newFile: File | null) => void; setNotice: SetNotice }) {
  const { app, actor, editing } = props;
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState(editing?.role ?? "");
  const [processed, setProcessed] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      const png = await toTransparentPng(file);
      if (png.size > 2 * 1024 * 1024) { setError("Ảnh sau khi xử lý lớn hơn 2 MB, hãy chụp/cắt nhỏ hơn."); return; }
      setProcessed(png);
      setPreview(URL.createObjectURL(png));
    } catch { setError("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); }
    finally { setProcessing(false); }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing && !processed) { setError("Vui lòng chọn ảnh chữ ký."); return; }
    setBusy(true);
    const file = processed ? { id: randomIds().next(), name: processed.name, mime: processed.type, size: processed.size, hasTransparency: true } : undefined;
    const result = editing
      ? await app.signatures.update(actor, { id: editing.id, expectedVersion: editing.version, name, role, ...(file ? { file } : {}) })
      : await app.signatures.add(actor, { name, role, file: file! });
    setBusy(false);
    if (!result.ok) { setError(issueText(result.errors[0]?.code ?? "SIG_INVALID")); return; }
    props.onSaved(result.value, processed);
  };

  const shown = preview ?? props.currentImageUrl;
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card signature-form" onSubmit={(event) => void save(event)} aria-labelledby="signature-form-title">
        <header><h2 id="signature-form-title">{editing ? "Sửa chữ ký" : "Thêm chữ ký"}</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button></header>
        <div className="signature-form-body">
          <label className="field"><span>Họ tên người ký *</span><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} autoFocus /></label>
          <label className="field"><span>Chức danh *</span><input value={role} onChange={(event) => setRole(event.target.value)} required minLength={2} maxLength={100} placeholder="vd: Giám đốc" /></label>
          <div className="signature-drop">
            <div className="checkerboard signature-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {processing ? <span className="muted">Đang tách nền trắng…</span> : shown ? <img src={shown} alt="Xem trước chữ ký" /> : <span className="muted">Chưa có ảnh chữ ký</span>}
            </div>
            <label className="button"><ImagePlus className="ico" size={16} aria-hidden="true" /> {shown ? "Chọn ảnh khác" : "Chọn ảnh chữ ký"}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            <p className="muted">Chụp chữ ký trên giấy trắng; nền trắng được tách tự động trước khi lưu.{editing && !processed ? " Không chọn ảnh mới thì giữ ảnh cũ." : ""}</p>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer><button className="button" type="button" onClick={props.onClose}>Hủy</button><button className="button primary" type="submit" disabled={busy || processing}>{processing ? "Đang xử lý ảnh…" : busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Lưu chữ ký"}</button></footer>
      </form>
    </div>
  );
}
