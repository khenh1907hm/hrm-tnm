import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { removeWhiteBackground } from "../../lib/image/removeWhiteBackground";
import { sequentialIds } from "../../lib/ids";
import type { Actor } from "../../modules/auth/permissions";
import { issueText, type App, type SetNotice } from "./shared";

export function SignatureFormModal(props: { app: App; actor: Actor; onClose: () => void; onSaved: (fileId: string, file: File) => void; setNotice: SetNotice }) {
  const { app, actor, setNotice } = props;
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);

  useEffect(() => () => { if (signaturePreview) URL.revokeObjectURL(signaturePreview); }, [signaturePreview]);

  const saveSignature = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const upload = formData.get("signatureFile");
    if (!(upload instanceof File) || upload.size === 0) { setNotice("Vui lòng chọn ảnh PNG chữ ký."); return; }
    let transparentFile: File;
    try {
      const bitmap = await createImageBitmap(upload);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Không thể xử lý ảnh chữ ký.");
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const processed = removeWhiteBackground({ data: pixels.data, width: pixels.width, height: pixels.height });
      pixels.data.set(processed.data);
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh chữ ký PNG.")), "image/png"));
      transparentFile = new File([blob], `${upload.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
    } catch { setNotice("Không đọc được ảnh chữ ký. Hãy chọn ảnh JPG, PNG hoặc WebP khác."); return; }
    const id = sequentialIds("signature").next();
    const result = await app.signatures.add(actor, { name: String(formData.get("name") ?? ""), role: String(formData.get("role") ?? ""), file: { id, name: transparentFile.name, mime: transparentFile.type, size: transparentFile.size, hasTransparency: true } });
    if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "SIG_INVALID")); return; }
    props.onSaved(id, transparentFile);
  };

  return <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={(event) => void saveSignature(event)}><header><h2>Thêm chữ ký</h2><button type="button" className="close" onClick={props.onClose}>×</button></header><div className="form-grid"><label className="field"><span>Họ tên người ký</span><input name="name" required minLength={2} maxLength={100} /></label><label className="field"><span>Chức danh</span><input name="role" required minLength={2} maxLength={100} /></label><label className="field"><span>Ảnh chụp chữ ký trên giấy trắng</span><input name="signatureFile" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => { const file = event.target.files?.[0]; setSignaturePreview(file ? URL.createObjectURL(file) : null); }} /></label>{signaturePreview && <div className="checkerboard signature-preview"><Image src={signaturePreview} width={500} height={180} unoptimized alt="Bản xem trước chữ ký đã chọn" /></div>}<p className="muted">Nền trắng sẽ được tách trong trình duyệt trước khi lưu.</p></div><footer><button className="button" type="button" onClick={props.onClose}>Hủy</button><button className="button primary" type="submit">Lưu chữ ký</button></footer></form></div>;
}
