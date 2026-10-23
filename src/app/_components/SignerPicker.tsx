import { useEffect, useMemo, useState } from "react";
import { Eraser, PenLine, Undo2 } from "lucide-react";
import { toTransparentPng } from "../../lib/image/toTransparentPng";
import type { Actor } from "../../modules/auth/permissions";
import type { Signer } from "../../modules/excel-template/engine/fieldValues";
import type { Signature } from "../../modules/signatures/types";
import type { App } from "./shared";

/** Người ký đã chọn, kèm ảnh chữ ký (PNG nền trong suốt) để chèn vào vùng IMG_signature. */
export type ChosenSigner = (Signer & { image: Blob | null }) | null;
/** Lấy tệp ảnh chữ ký (từ phiên hoặc kho lưu trữ); không có thì trả null. */
export type SignatureFileLoader = (file: Signature["file"]) => Promise<File | null>;

type Loaded = { id: string; name: string; role: string; original: Blob | null };

/**
 * Chọn người ký từ Thư viện chữ ký (mặc định: chữ ký đặt làm mặc định).
 * Tên, chức danh điền vào {{signerName}}, {{signerRole}}, {{signerTitle}}; ảnh vào vùng IMG_signature.
 * Ảnh còn nền mờ thì bấm "Xóa nền" để tách lại cho lần xuất này (ảnh trong thư viện không đổi).
 */
export function SignerPicker(props: { app: App; actor: Actor; loadFile?: SignatureFileLoader | undefined; onChange: (signer: ChosenSigner) => void; preferredId?: string | undefined }) {
  const { app, actor, loadFile, onChange, preferredId } = props;
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [cleaned, setCleaned] = useState<{ id: string; image: Blob } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState("");

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

  // Đổi người ký → tải ảnh chữ ký gốc
  useEffect(() => {
    const signature = signatures?.find((item) => item.id === selectedId);
    let active = true;
    if (!signature) return () => { active = false; };
    const done = (original: Blob | null) => { if (active) setLoaded({ id: signature.id, name: signature.name, role: signature.role, original }); };
    void (loadFile ? loadFile(signature.file) : Promise.resolve(null)).then(done, () => done(null));
    return () => { active = false; };
  }, [signatures, selectedId, loadFile]);

  const current = loaded?.id === selectedId ? loaded : null;
  const cleanedImage = cleaned && current && cleaned.id === current.id ? cleaned.image : null;
  const image = cleanedImage ?? current?.original ?? null;

  // Báo người ký + ảnh đang dùng (đã xóa nền nếu có) lên form xuất
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (!signatures?.some((item) => item.id === selectedId)) onChange(null);
      else if (current) onChange({ name: current.name, role: current.role, image });
    });
    return () => { active = false; };
  }, [signatures, selectedId, current, image, onChange]);

  const preview = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const removeBackground = async () => {
    if (!current?.original) return;
    setCleaning(true);
    setCleanError("");
    try {
      const png = await toTransparentPng(new File([current.original], "chu-ky.png", { type: current.original.type || "image/png" }), 1600, { force: true });
      setCleaned({ id: current.id, image: png });
    } catch { setCleanError("Không xử lý được ảnh chữ ký này."); }
    finally { setCleaning(false); }
  };

  return (
    <div className="signer-picker">
      <label className="field">
        <span><PenLine className="ico" size={14} aria-hidden="true" /> Người ký</span>
        {signatures === null ? <span className="muted">Đang tải thư viện chữ ký…</span> : signatures.length === 0
          ? <span className="muted">Chưa có chữ ký nào. Thêm ở mục Thư viện chữ ký.</span>
          : <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name} - {signature.role}{signature.isDefault ? " (mặc định)" : ""}</option>)}
          </select>}
      </label>
      {selectedId && !current && <small className="muted">Đang tải ảnh chữ ký…</small>}
      {current && (
        <div className="signer-image">
          <div className="signer-image-stage checkerboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {cleaning ? <span className="muted">Đang xóa nền…</span> : preview ? <img src={preview} alt={`Ảnh chữ ký của ${current.name}`} /> : <span className="muted">Chưa có ảnh chữ ký</span>}
          </div>
          {current.original && (
            <div className="signer-image-actions">
              {cleanedImage
                ? <><small className="muted">Đã xóa nền cho lần xuất này.</small><button type="button" className="button" onClick={() => setCleaned(null)}><Undo2 className="ico" size={14} aria-hidden="true" /> Hoàn tác</button></>
                : <button type="button" className="button" disabled={cleaning} onClick={() => void removeBackground()}><Eraser className="ico" size={14} aria-hidden="true" /> Xóa nền</button>}
            </div>
          )}
          {cleanError && <small className="form-error">{cleanError}</small>}
        </div>
      )}
    </div>
  );
}
