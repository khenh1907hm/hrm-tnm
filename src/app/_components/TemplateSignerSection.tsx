import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, PenLine } from "lucide-react";
import { parseRange } from "../../modules/excel-template/engine/fillWorkbook";
import type { ProfileTemplateConfig } from "../../modules/excel-template/types";
import type { Signature } from "../../modules/signatures/types";
import type { SignatureFileLoader } from "./SignerPicker";

const SIGNER_CODES = ["signerTitle", "signerName", "signerNameUpper", "signerRole"] as const;

const rangeError = (range: string) => {
  if (!range.trim()) return null;
  try { parseRange(range); return null; } catch { return "Vùng ô chưa đúng, ví dụ đúng: AB40:AK46."; }
};

/**
 * Mục "Người ký" của mẫu hồ sơ: chọn chữ ký mặc định từ Thư viện chữ ký (đổi được khi xuất),
 * xem mẫu đã có ô tên người ký / vùng ảnh chữ ký chưa, và nhập vùng ảnh chữ ký ngay tại đây.
 */
export function TemplateSignerSection(props: { value: ProfileTemplateConfig; onChange: (value: ProfileTemplateConfig) => void; signatures: readonly Signature[] | null; loadSignatureFile?: SignatureFileLoader | undefined }) {
  const { value, onChange, signatures, loadSignatureFile } = props;
  const slot = value.imageSlots.find((item) => item.field === "signature");
  const usedCodes = SIGNER_CODES.filter((code) => value.placeholders.includes(code));
  const fallback = signatures?.find((item) => item.isDefault) ?? signatures?.[0];
  const chosen = signatures?.find((item) => item.id === value.signatureId) ?? fallback;
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);

  // Ảnh xem trước của chữ ký đang chọn
  useEffect(() => {
    if (!chosen || !loadSignatureFile) return;
    let active = true;
    let url: string | null = null;
    void loadSignatureFile(chosen.file).then((file) => {
      if (!active || !file) return;
      url = URL.createObjectURL(file);
      setPreview({ id: chosen.id, url });
    }, () => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [chosen, loadSignatureFile]);

  const setSlotRange = (range: string) => {
    const others = value.imageSlots.filter((item) => item.field !== "signature");
    const next = range.trim() ? [...others, { field: "signature", range: range.toUpperCase(), fit: "contain" as const, custom: true }] : others;
    onChange({ ...value, imageSlots: next });
  };

  return (
    <section className="template-signer">
      <h3><PenLine className="ico" size={15} aria-hidden="true" /> 2. Người ký</h3>
      <p className="muted">Chữ ký lấy từ <b>Thư viện chữ ký</b>. Chọn người ký mặc định cho mẫu này; lúc xuất vẫn đổi được.</p>

      <div className="template-signer-body">
        <div className="signer-preview checkerboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {chosen && preview?.id === chosen.id ? <img src={preview.url} alt={`Chữ ký ${chosen.name}`} /> : <span className="muted">{chosen ? "Đang tải ảnh…" : "Chưa có chữ ký"}</span>}
        </div>
        <div className="template-signer-fields">
          <label className="field">
            <span>Người ký mặc định</span>
            {signatures === null ? <span className="muted">Đang tải thư viện chữ ký…</span> : signatures.length === 0
              ? <span className="muted">Thư viện chữ ký đang trống. Thêm chữ ký ở mục <b>Thư viện chữ ký</b> trước.</span>
              : <select value={chosen?.id ?? ""} onChange={(event) => onChange({ ...value, signatureId: event.target.value })}>
                {signatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name} - {signature.role}{signature.isDefault ? " (mặc định của thư viện)" : ""}</option>)}
              </select>}
          </label>

          <ul className="signer-checklist">
            <li className={usedCodes.length ? "ok" : "todo"}>
              {usedCodes.length ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
              <span>
                <b>Tên, chức danh người ký:</b>{" "}
                {usedCodes.length
                  ? <>mẫu đang dùng {usedCodes.map((code) => <code key={code}>{`{{${code}}}`}</code>)}</>
                  : <>chưa có. Trong Excel, thay dòng tên viết sẵn bằng <code>{"{{signerTitle}}"}</code> (ra “{chosen ? `${chosen.name} - ${chosen.role}` : "Họ tên - Chức danh"}”), rồi tải lại file.</>}
              </span>
            </li>
            <li className={slot?.range ? "ok" : "todo"}>
              {slot?.range ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
              <span><b>Vị trí ảnh chữ ký:</b> {slot?.range ? "ảnh được co vừa vùng ô này và căn giữa." : "chưa có. Nhập vùng ô trống phía trên dòng tên."}</span>
            </li>
          </ul>
          <label className="field signer-range">
            <span>Vùng ô đặt ảnh chữ ký</span>
            <input value={slot?.range ?? ""} placeholder="vd: AB40:AK46" onChange={(event) => setSlotRange(event.target.value)} />
            {rangeError(slot?.range ?? "") && <small className="form-error">{rangeError(slot?.range ?? "")}</small>}
          </label>
        </div>
      </div>
    </section>
  );
}
