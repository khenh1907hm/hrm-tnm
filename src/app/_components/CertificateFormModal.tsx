import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import { isSafetyCertificateType, SAFETY_GROUPS, safetyGroupTitle } from "../../modules/certificates/safetyGroup";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Employee } from "../../modules/employees/types";
import { CertificateFilesField, initialFileItems, splitFileItems, type CertificateFileItem } from "./CertificateFilesField";
import { issueText, type App, type SetNotice } from "./shared";

/** Thêm mới khi cả `editing` lẫn `renewing` đều null. */
export type CertificateFormMode = { type: string; editing: Certificate | null; renewing: Certificate | null; safetyGroup?: number };

const isGroupTitle = (title: string) => /^Nhóm [1-6]$/.test(title.trim());

export function CertificateFormModal(props: { app: App; actor: Actor; employee: Employee; certificateTypes: CertificateTypeRecord[]; existingCertificates: readonly Certificate[]; mode: CertificateFormMode; onClose: () => void; onSaved: (files: Record<string, File>, message: string) => void; setNotice: SetNotice }) {
  const { app, actor, employee: selected, certificateTypes, setNotice } = props;
  const { type: selectedCertificateType, editing: editingCertificate, renewing: renewingCertificate } = props.mode;
  const base = editingCertificate ?? renewingCertificate;
  const type = renewingCertificate?.type ?? editingCertificate?.type ?? selectedCertificateType;
  const typeName = certificateTypes.find((item) => item.key === type)?.name ?? "Chứng chỉ";
  const isSafety = isSafetyCertificateType(type);
  // Nhóm đang có ở chứng chỉ ATLĐ hiện hành khác → không cho chọn trùng
  const takenGroups = new Set(props.existingCertificates.filter((item) => item.state === "current" && isSafetyCertificateType(item.type) && item.id !== base?.id && item.safetyGroup).map((item) => item.safetyGroup as number));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [safetyGroup, setSafetyGroup] = useState<string>(() => String(base?.safetyGroup ?? props.mode.safetyGroup ?? (selected.group && !takenGroups.has(selected.group) ? selected.group : "")));
  const [files, setFiles] = useState<CertificateFileItem[]>(() => initialFileItems(base?.document, base?.supplementaryFiles));
  const customTitle = base && !(isSafety && isGroupTitle(base.title)) ? base.title : "";

  const saveCertificate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const knownType = certificateTypes.find((candidate) => candidate.key === type)?.key;
    if (!knownType) { setNotice("Loại chứng chỉ không hợp lệ."); return; }
    if (isSafety && !safetyGroup) { setErrors({ safetyGroup: "Chọn nhóm huấn luyện an toàn lao động." }); return; }
    const { document, supplementaryFiles, newBinaries } = splitFileItems(files);
    if (!document) { setErrors({ document: "Thêm ít nhất một tệp chứng chỉ (tệp chính)." }); return; }
    // ATLĐ: để trống tên phân biệt → tên tự là "Nhóm N"
    const title = isSafety ? String(formData.get("title") ?? customTitle) : String(formData.get("title") ?? "");
    const certificateInput = {
      type: knownType,
      number: String(formData.get("number") ?? ""),
      issueDate: String(formData.get("issueDate") ?? "") || null,
      expiryDate: String(formData.get("expiryDate") ?? ""),
      document,
      title: renewingCertificate ? renewingCertificate.title : title,
      supplementaryFiles,
      safetyGroup: isSafety ? Number(safetyGroup) : null,
    };
    if (app.certificates.preview) {
      const previewResult = await app.certificates.preview(actor, { ...certificateInput, employeeId: selected.id, ...(editingCertificate ? { id: editingCertificate.id } : renewingCertificate ? { id: renewingCertificate.id } : {}) });
      if (!previewResult.ok) { setErrors(Object.fromEntries(previewResult.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return; }
      if (previewResult.warnings.length > 0 && !window.confirm(previewResult.warnings.map((item) => issueText(item.code)).join("\n"))) return;
    }
    const result = renewingCertificate
      ? await app.certificates.renew(actor, { ...certificateInput, id: renewingCertificate.id, expectedVersion: renewingCertificate.version })
      : editingCertificate
        ? await app.certificates.update(actor, { ...certificateInput, id: editingCertificate.id, expectedVersion: editingCertificate.version })
        : await app.certificates.add(actor, { ...certificateInput, employeeId: selected.id });
    if (!result.ok) { setErrors(Object.fromEntries(result.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return; }
    props.onSaved(newBinaries, renewingCertificate ? "Đã gia hạn chứng chỉ; bản cũ được lưu trong lịch sử." : editingCertificate ? "Đã cập nhật chứng chỉ." : "Đã thêm chứng chỉ.");
  };

  const heading = renewingCertificate ? "Gia hạn chứng chỉ" : editingCertificate ? "Sửa chứng chỉ" : "Thêm chứng chỉ";
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card cert-form" onSubmit={(event) => void saveCertificate(event)} aria-labelledby="cert-form-title">
        <header>
          <div><h2 id="cert-form-title">{heading}</h2><p className="muted cert-form-type">{typeName}{base?.title ? ` · ${base.title}` : ""}</p></div>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="form-grid">
          {isSafety && (
            <fieldset className="field safety-group-field">
              <legend>Nhóm huấn luyện ATVSLĐ <abbr title="Bắt buộc">*</abbr></legend>
              <div className="safety-group-options">
                {SAFETY_GROUPS.map((item) => {
                  const taken = takenGroups.has(item.group);
                  const locked = Boolean(renewingCertificate) && String(item.group) !== safetyGroup;
                  return (
                    <label key={item.group} className={`safety-option${String(item.group) === safetyGroup ? " is-selected" : ""}${taken || locked ? " is-disabled" : ""}`}>
                      <input type="radio" name="safetyGroup" value={item.group} checked={String(item.group) === safetyGroup} disabled={taken || locked} onChange={() => setSafetyGroup(String(item.group))} />
                      <b>{item.label}</b>
                      <small>{taken ? "Đã có chứng chỉ nhóm này" : item.description}</small>
                    </label>
                  );
                })}
              </div>
              <small className="field-help">Theo Nghị định 44/2016/NĐ-CP. Một người có nhiều nhóm thì thêm từng nhóm thành một chứng chỉ riêng.{renewingCertificate ? " Khi gia hạn không đổi nhóm." : ""}</small>
              {errors.safetyGroup && <small>{errors.safetyGroup}</small>}
            </fieldset>
          )}
          {!renewingCertificate && (
            <label className="field">
              <span>Tên phân biệt {isSafety ? "(để trống sẽ là “" + (safetyGroup ? safetyGroupTitle(Number(safetyGroup)) : "Nhóm N") + "”)" : "(nếu có nhiều chứng chỉ cùng loại)"}</span>
              <input name="title" defaultValue={editingCertificate ? customTitle : ""} maxLength={60} />
              {errors.title && <small>{errors.title}</small>}
            </label>
          )}
          <label className="field"><span>Số chứng chỉ <abbr title="Bắt buộc">*</abbr></span><input name="number" required minLength={3} maxLength={50} defaultValue={editingCertificate?.number ?? ""} />{errors.number && <small>{errors.number}</small>}</label>
          <label className="field"><span>Ngày cấp</span><input name="issueDate" type="date" defaultValue={editingCertificate?.issueDate ?? ""} />{errors.issueDate && <small>{errors.issueDate}</small>}</label>
          <label className="field"><span>Ngày hết hạn <abbr title="Bắt buộc">*</abbr></span><input name="expiryDate" type="date" required defaultValue={editingCertificate?.expiryDate ?? ""} />{errors.expiryDate && <small>{errors.expiryDate}</small>}</label>
          <CertificateFilesField items={files} onChange={setFiles} error={errors.document ?? errors.supplementaryFiles} />
          {errors.form && <p className="form-error">{errors.form}</p>}
        </div>
        <footer>
          <button className="button" type="button" onClick={props.onClose}>Hủy</button>
          <button className="button primary" type="submit">{renewingCertificate ? "Gia hạn" : editingCertificate ? "Lưu thay đổi" : "Lưu chứng chỉ"}</button>
        </footer>
      </form>
    </div>
  );
}
