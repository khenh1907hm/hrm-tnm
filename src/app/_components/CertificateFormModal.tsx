import { FolderOpen, Paperclip } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { sequentialIds } from "../../lib/ids";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Employee } from "../../modules/employees/types";
import { issueText, type App, type SetNotice } from "./shared";

/** Thêm mới khi cả `editing` lẫn `renewing` đều null. */
export type CertificateFormMode = { type: string; editing: Certificate | null; renewing: Certificate | null };

export function CertificateFormModal(props: { app: App; actor: Actor; employee: Employee; certificateTypes: CertificateTypeRecord[]; mode: CertificateFormMode; onClose: () => void; onSaved: (files: Record<string, File>, message: string) => void; setNotice: SetNotice }) {
  const { app, actor, employee: selected, certificateTypes, setNotice } = props;
  const { type: selectedCertificateType, editing: editingCertificate, renewing: renewingCertificate } = props.mode;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [supplementaryDraft, setSupplementaryDraft] = useState<{ id: string; file: File; label: string }[]>([]);
  const [removedSupplementaryIds, setRemovedSupplementaryIds] = useState<string[]>([]);
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [primaryDragOver, setPrimaryDragOver] = useState(false);
  const [suppDragOver, setSuppDragOver] = useState(false);
  const primaryFileInputRef = useRef<HTMLInputElement | null>(null);
  const suppFileInputRef = useRef<HTMLInputElement | null>(null);

  const saveCertificate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // Prioritise drag-dropped primaryFile over <input type=file>
    const inputUpload = formData.get("document");
    const upload = primaryFile ?? (inputUpload instanceof File && inputUpload.size > 0 ? inputUpload : null);
    if (!upload && !editingCertificate) { setErrors({ document: "Vui lòng chọn tệp chứng chỉ chính." }); return; }
    const rawType = renewingCertificate?.type ?? editingCertificate?.type ?? selectedCertificateType;
    const type = certificateTypes.find((candidate) => candidate.key === rawType)?.key;
    if (!type) { setNotice("Loại chứng chỉ không hợp lệ."); return; }
    const supplementaryUploads = supplementaryDraft.map((item) => ({ file: item.file, label: item.label }));
    const savedFiles = ((editingCertificate ?? renewingCertificate)?.supplementaryFiles ?? []).filter((item) => !removedSupplementaryIds.includes(item.file.id));
    const newSupplementary = supplementaryUploads.map((item) => ({ file: { id: sequentialIds("file").next(), name: item.file.name, mime: item.file.type, size: item.file.size }, label: item.label, binary: item.file }));
    const docRef = upload ? { id: sequentialIds("file").next(), name: upload.name, mime: upload.type, size: upload.size } : (editingCertificate ?? renewingCertificate)?.document ?? null;
    const certificateInput = {
      type,
      number: String(formData.get("number") ?? ""),
      issueDate: String(formData.get("issueDate") ?? "") || null,
      expiryDate: String(formData.get("expiryDate") ?? ""),
      document: docRef,
      title: String(formData.get("title") ?? ""),
      supplementaryFiles: [...savedFiles, ...newSupplementary.map((item) => ({ file: item.file, label: item.label }))],
    };
    // Preview & warn BEFORE saving
    if (app.certificates.preview) {
      const previewResult = await app.certificates.preview(actor, { ...certificateInput, employeeId: selected.id, ...(editingCertificate ? { id: editingCertificate.id } : {}) });
      if (!previewResult.ok) { setErrors(Object.fromEntries(previewResult.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return; }
      if (previewResult.warnings.length > 0 && !window.confirm(previewResult.warnings.map((item) => issueText(item.code)).join("\n"))) return;
    }
    const result = renewingCertificate
      ? await app.certificates.renew(actor, { ...certificateInput, id: renewingCertificate.id, expectedVersion: renewingCertificate.version })
      : editingCertificate
        ? await app.certificates.update(actor, { ...certificateInput, id: editingCertificate.id, expectedVersion: editingCertificate.version })
        : await app.certificates.add(actor, { ...certificateInput, employeeId: selected.id });
    if (!result.ok) { setErrors(Object.fromEntries(result.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return; }
    const files = { ...(upload ? { [result.value.document.id]: upload } : {}), ...Object.fromEntries(newSupplementary.map((item) => [item.file.id, item.binary])) };
    props.onSaved(files, renewingCertificate ? "Đã gia hạn chứng chỉ; bản cũ được lưu trong lịch sử." : editingCertificate ? "Đã cập nhật chứng chỉ." : "Đã thêm chứng chỉ.");
  };

  return <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={(event) => void saveCertificate(event)}><header><h2>{renewingCertificate ? "Gia hạn chứng chỉ" : editingCertificate ? "Sửa chứng chỉ" : "Thêm chứng chỉ"}</h2><button type="button" className="close" onClick={props.onClose}>×</button></header><div className="form-grid"><p className="field"><span>Loại chứng chỉ</span><b>{certificateTypes.find((type) => type.key === selectedCertificateType)?.name ?? "Chứng chỉ"}</b></p><label className="field"><span>Tên phân biệt (nếu cần)</span><input name="title" defaultValue={editingCertificate?.title ?? renewingCertificate?.title ?? ""} maxLength={60} />{errors.title && <small>{errors.title}</small>}</label><label className="field"><span>Số chứng chỉ</span><input name="number" required minLength={3} maxLength={50} defaultValue={editingCertificate?.number ?? renewingCertificate?.number ?? ""} />{errors.number && <small>{errors.number}</small>}</label><label className="field"><span>Ngày cấp</span><input name="issueDate" type="date" defaultValue={editingCertificate?.issueDate ?? renewingCertificate?.issueDate ?? ""} />{errors.issueDate && <small>{errors.issueDate}</small>}</label><label className="field"><span>Ngày hết hạn</span><input name="expiryDate" type="date" required defaultValue={editingCertificate?.expiryDate ?? ""} />{errors.expiryDate && <small>{errors.expiryDate}</small>}</label><div className="field"><span>Tệp chứng chỉ chính (PDF/JPG/PNG/WebP, tối đa 10 MB mỗi tệp)</span><div className={primaryDragOver ? "cert-dropzone dragover" : "cert-dropzone"} onClick={() => primaryFileInputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setPrimaryDragOver(true); }} onDragLeave={() => setPrimaryDragOver(false)} onDrop={(e) => { e.preventDefault(); setPrimaryDragOver(false); const f = e.dataTransfer.files[0]; if (f) { setPrimaryFile(f); } }}>{primaryFile ? <span className="pill ok"><Paperclip className="ico" size={14} aria-hidden="true" /> {primaryFile.name} (Bấm để đổi tệp)</span> : <><span className="cert-dropzone-text"><FolderOpen className="ico" size={16} aria-hidden="true" /> Bấm vào đây hoặc kéo thả để chọn tệp chính</span><button type="button" className="cert-dropzone-btn">Chọn tệp chính</button></>}<input ref={primaryFileInputRef} name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required={!editingCertificate && !primaryFile} onChange={(e) => { const f = e.target.files?.[0]; if (f) setPrimaryFile(f); }} /></div>{errors.document && <small>{errors.document}</small>}</div><div className="field"><span>Tệp bổ sung (có thể kéo thả hoặc chọn nhiều tệp)</span><div className={suppDragOver ? "cert-dropzone dragover" : "cert-dropzone"} onClick={() => suppFileInputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setSuppDragOver(true); }} onDragLeave={() => setSuppDragOver(false)} onDrop={(e) => { e.preventDefault(); setSuppDragOver(false); const files = Array.from(e.dataTransfer.files); setSupplementaryDraft((cur) => [...cur, ...files.map((file) => ({ id: sequentialIds("draft-file").next(), file, label: file.name }))]); }}><span className="cert-dropzone-text"><FolderOpen className="ico" size={16} aria-hidden="true" /> Bấm vào đây hoặc kéo thả để thêm tệp bổ sung</span><button type="button" className="cert-dropzone-btn">Chọn tệp bổ sung</button><input ref={suppFileInputRef} name="supplementary" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSupplementaryDraft((current) => [...current, ...Array.from(event.target.files ?? []).map((file) => ({ id: sequentialIds("draft-file").next(), file, label: file.name }))])} /></div>{editingCertificate?.supplementaryFiles.filter((item) => !removedSupplementaryIds.includes(item.file.id)).map((item) => <div className="supplementary-draft" key={item.file.id}><span>{item.label ?? item.file.name}</span><button type="button" className="button" onClick={() => setRemovedSupplementaryIds((current) => [...current, item.file.id])}>Xóa {item.file.name}</button></div>)}{supplementaryDraft.map((item) => <div className="supplementary-draft" key={item.id}><input aria-label={`Nhãn tệp ${item.file.name}`} value={item.label} onChange={(event) => setSupplementaryDraft((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate))} /><button type="button" className="button" onClick={() => setSupplementaryDraft((current) => current.filter((candidate) => candidate.id !== item.id))}>Xóa {item.file.name}</button></div>)}{errors.supplementaryFiles && <small>{errors.supplementaryFiles}</small>}</div>{errors.form && <p className="form-error">{errors.form}</p>}</div><footer><button className="button" type="button" onClick={props.onClose}>Hủy</button><button className="button primary" type="submit">{renewingCertificate ? "Gia hạn" : editingCertificate ? "Lưu thay đổi" : "Lưu chứng chỉ"}</button></footer></form></div>;
}
