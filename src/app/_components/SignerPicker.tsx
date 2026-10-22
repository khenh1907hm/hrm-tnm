import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import type { Signer } from "../../modules/excel-template/engine/fieldValues";
import type { Signature } from "../../modules/signatures/types";
import type { App } from "./shared";

/** Người ký đã chọn, kèm ảnh chữ ký (PNG nền trong suốt) để chèn vào vùng IMG_signature. */
export type ChosenSigner = (Signer & { image: Blob | null }) | null;
/** Lấy tệp ảnh chữ ký (từ phiên hoặc kho lưu trữ); không có thì trả null. */
export type SignatureFileLoader = (file: Signature["file"]) => Promise<File | null>;

/**
 * Chọn người ký từ Thư viện chữ ký (mặc định: chữ ký đặt làm mặc định).
 * Tên, chức danh điền vào {{signerName}}, {{signerRole}}, {{signerTitle}}; ảnh vào vùng IMG_signature.
 */
export function SignerPicker(props: { app: App; actor: Actor; loadFile?: SignatureFileLoader | undefined; onChange: (signer: ChosenSigner) => void; preferredId?: string | undefined }) {
  const { app, actor, loadFile, onChange, preferredId } = props;
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);

  useEffect(() => {
    let active = true;
    void app.signatures.list(actor).then((result) => {
      if (!active) return;
      const list = result.ok ? result.value : [];
      setSignatures(list);
      // Ưu tiên chữ ký cài trong mẫu, rồi đến chữ ký mặc định của thư viện
      setSelectedId((current) => current || (list.find((item) => item.id === preferredId) ?? list.find((item) => item.isDefault) ?? list[0])?.id || "");
    });
    return () => { active = false; };
  }, [app, actor, preferredId]);

  // Đổi người ký → tải ảnh chữ ký rồi báo lên form xuất
  useEffect(() => {
    const signature = signatures?.find((item) => item.id === selectedId);
    let active = true;
    if (!signature) { queueMicrotask(() => { if (active) onChange(null); }); return () => { active = false; }; }
    queueMicrotask(() => { if (active) setLoadingImage(true); });
    const done = (image: Blob | null) => { if (!active) return; setLoadingImage(false); onChange({ name: signature.name, role: signature.role, image }); };
    void (loadFile ? loadFile(signature.file) : Promise.resolve(null)).then(done, () => done(null));
    return () => { active = false; };
  }, [signatures, selectedId, loadFile, onChange]);

  return (
    <label className="field signer-picker">
      <span><PenLine className="ico" size={14} aria-hidden="true" /> Người ký</span>
      {signatures === null ? <span className="muted">Đang tải thư viện chữ ký…</span> : signatures.length === 0
        ? <span className="muted">Chưa có chữ ký nào. Thêm ở mục Thư viện chữ ký.</span>
        : <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name} - {signature.role}{signature.isDefault ? " (mặc định)" : ""}</option>)}
        </select>}
      {loadingImage && <small className="muted">Đang tải ảnh chữ ký…</small>}
    </label>
  );
}
