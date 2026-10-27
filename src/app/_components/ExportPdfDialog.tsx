import { FileText, Paperclip } from "lucide-react";
import { useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { systemClock, todayVN } from "../../lib/clock";
import { normalizeText } from "../../lib/text";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import { formatExpiry } from "../../modules/certificates/status";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Employee } from "../../modules/employees/types";
import { renderWorkerProfilePdf, type ScanBinary } from "../../modules/exports/pdf/renderWorkerProfilePdf";
import { getSelectableProfileCertificates } from "../../modules/exports/workerProfile";
import { issueText, readinessFieldLabel, type App, type SetNotice, type SignatureRow } from "./shared";
import type { Commander } from "../../modules/commanders/types";
import { ContactPicker, EMPTY_CONTACT, type ContactChoice } from "./ContactPicker";

type Readiness = { errors: { field: string; code: string }[]; warnings: string[] };
export type ExportDialogInit = { signatures: SignatureRow[]; certificateTypes: CertificateTypeRecord[]; signerId: string; signDate: string; selectedCertificateIds: string[]; selectedFileIds: string[]; readiness: Readiness | null };

/** Nạp dữ liệu cần cho hộp thoại; trả về thông báo lỗi nếu không mở được. */
export async function prepareExportDialog(app: App, actor: Actor, employee: Employee, employeeCertificates: Certificate[]): Promise<{ ok: true; init: ExportDialogInit } | { ok: false; message: string }> {
  const [listed, types] = await Promise.all([app.signatures.list(actor), app.certificateTypes.list(actor)]);
  if (!listed.ok) return { ok: false, message: issueText(listed.errors[0]?.code ?? "FORBIDDEN") };
  if (!types.ok) return { ok: false, message: issueText(types.errors[0]?.code ?? "FORBIDDEN") };
  const defaultSigner = listed.value.find((signature) => signature.isDefault) ?? listed.value[0];
  const signDate = todayVN(systemClock);
  const choices = getSelectableProfileCertificates(employee.id, signDate, employeeCertificates, types.value);
  const defaultCerts = choices.system.flatMap((group) => group.certificates.slice(0, 1));
  const readiness = await app.exports.checkReadiness(actor, { employeeId: employee.id, signDate, signerId: defaultSigner?.id ?? "" });
  return {
    ok: true,
    init: {
      signatures: listed.value,
      certificateTypes: types.value,
      signerId: defaultSigner?.id ?? "",
      signDate,
      selectedCertificateIds: defaultCerts.map((item) => item.id),
      selectedFileIds: defaultCerts.map((item) => item.document.id),
      readiness: readiness.ok ? readiness.value : null,
    },
  };
}

async function toScanBinaries(sessionFiles: Record<string, File>): Promise<Map<string, ScanBinary>> {
  const binaries = new Map<string, ScanBinary>();
  for (const [id, file] of Object.entries(sessionFiles)) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    let mime = file.type;
    if (mime === "image/webp") {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Không thể chuyển ảnh WebP sang PNG.");
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể chuyển ảnh WebP sang PNG.")), "image/png"));
      bytes = new Uint8Array(await png.arrayBuffer()); mime = "image/png";
    }
    binaries.set(id, { bytes, mime });
  }
  return binaries;
}

export function ExportPdfDialog(props: { app: App; actor: Actor; employee: Employee; employeeCertificates: Certificate[]; certificateTypes: CertificateTypeRecord[]; sessionFiles: Record<string, File>; init: ExportDialogInit; onClose: () => void; onEditProfile: () => void; setNotice: SetNotice }) {
  const { app, actor, employee: selected, employeeCertificates, certificateTypes, sessionFiles, init, setNotice } = props;
  const [exportSignDate, setExportSignDate] = useState(init.signDate);
  const [exportSignerId, setExportSignerId] = useState(init.signerId);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>(init.selectedCertificateIds);
  const [extraExportIds, setExtraExportIds] = useState<string[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(init.selectedFileIds);
  const [exportReadiness, setExportReadiness] = useState<Readiness | null>(init.readiness);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPageCount, setExportPageCount] = useState<number | null>(null);
  const [contactChoice, setContactChoice] = useState<ContactChoice>(EMPTY_CONTACT);
  const [contact, setContact] = useState<Commander | null>(null);
  const selfIds = useMemo(() => [props.employee.id], [props.employee.id]);
  const exportSignatures = init.signatures;

  const exportChoices = useMemo(() => exportSignDate ? getSelectableProfileCertificates(selected.id, exportSignDate, employeeCertificates, certificateTypes) : null, [selected, exportSignDate, employeeCertificates, certificateTypes]);

  const refreshExportReadiness = async (signDate: string, signerId: string) => {
    const readiness = await app.exports.checkReadiness(actor, { employeeId: selected.id, signDate, signerId });
    if (readiness.ok) setExportReadiness(readiness.value);
    else setExportReadiness({ errors: readiness.errors.map((item) => ({ field: item.field ?? "form", code: item.code })), warnings: [] });
  };

  const createProfilePdf = async () => {
    if (exportReadiness?.errors.length) return;
    setExportBusy(true); setNotice("Đang tạo tệp PDF trong trình duyệt…");
    try {
      const result = await app.exports.buildWorkerProfile(actor, { contact: contact ? { name: contact.name, role: contact.role, phone: contact.phone, address: contact.address } : null, employeeId: selected.id, signDate: exportSignDate, signerId: exportSignerId, selectedCertificateIds: selectedExportIds, extraCertificateIds: extraExportIds, includeSupplementary: true, selectedFileIds });
      if (!result.ok) { setNotice(result.errors.map((item) => issueText(item.code)).join(" ")); return; }
      const binaries = await toScanBinaries(sessionFiles);
      const [regularResponse, boldResponse] = await Promise.all([fetch("/fonts/BeVietnamPro-Regular.ttf", { cache: "no-store" }), fetch("/fonts/BeVietnamPro-Bold.ttf", { cache: "no-store" })]);
      const regular = regularResponse.ok ? new Uint8Array(await regularResponse.arrayBuffer()) : null;
      const bold = boldResponse.ok ? new Uint8Array(await boldResponse.arrayBuffer()) : null;
      const pdfBytes = await renderWorkerProfilePdf(result.value, binaries, { regular, bold });
      const pdf = await PDFDocument.load(pdfBytes);
      setExportPageCount(pdf.getPageCount());
      const downloadBytes = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(downloadBytes).set(pdfBytes);
      const blob = new Blob([downloadBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const name = normalizeText(selected.name).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
      anchor.href = url; anchor.download = `HoSo_${selected.code}_${name}_${exportSignDate.replaceAll("-", "")}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(result.warnings.length ? result.warnings.map((item) => issueText(item.code)).join(" ") : "Đã tạo và tải hồ sơ PDF.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tạo hồ sơ PDF trong trình duyệt.");
    } finally { setExportBusy(false); }
  };

  const scanTree = (certificate: Certificate) => <div className="export-scan-tree"><span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Tùy chọn tệp scan đính kèm:</span><label className="export-scan-item"><input type="checkbox" checked={selectedFileIds.includes(certificate.document.id)} onChange={(e) => setSelectedFileIds((cur) => e.target.checked ? [...cur, certificate.document.id] : cur.filter((id) => id !== certificate.document.id))} /><span><FileText className="ico" size={14} aria-hidden="true" /> <b>Tệp chính:</b> {certificate.document.name}</span></label>{certificate.supplementaryFiles.map((supp) => <label className="export-scan-item" key={supp.file.id}><input type="checkbox" checked={selectedFileIds.includes(supp.file.id)} onChange={(e) => setSelectedFileIds((cur) => e.target.checked ? [...cur, supp.file.id] : cur.filter((id) => id !== supp.file.id))} /><span><Paperclip className="ico" size={14} aria-hidden="true" /> <b>Tệp bổ sung:</b> {supp.label || supp.file.name}</span></label>)}</div>;

  return <div className="modal-backdrop" role="presentation"><section className="modal-card export-dialog" role="dialog" aria-modal="true" aria-label="Xuất hồ sơ PDF"><header><h2>Xuất hồ sơ PDF</h2><button type="button" className="close" onClick={props.onClose}>×</button></header><div className="export-content"><div className="form-grid"><label className="field"><span>Người ký</span><select value={exportSignerId} onChange={(event) => { setExportSignerId(event.target.value); void refreshExportReadiness(exportSignDate, event.target.value); }}><option value="">Chọn người ký</option>{exportSignatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name} · {signature.role}{signature.isDefault ? " · Mặc định" : ""}</option>)}</select></label><label className="field"><span>Ngày ký</span><input type="date" value={exportSignDate} onChange={(event) => { setExportSignDate(event.target.value); void refreshExportReadiness(event.target.value, exportSignerId); }} /></label></div><ContactPicker app={app} actor={actor} value={contactChoice} preferredIds={selfIds} onChange={(value, next) => { setContactChoice(value); setContact(next); }} /><h3>Chứng chỉ đính kèm</h3><p>Mặc định chọn tệp chính của từng loại chứng chỉ. Bạn có thể chọn riêng tệp chính hoặc tệp bổ sung theo ý muốn.</p>{exportChoices?.system.map((group) => <fieldset className="export-cert-group" key={group.type}><legend>{group.displayName}</legend>{group.certificates.length ? group.certificates.map((certificate) => { const isCertSelected = selectedExportIds.includes(certificate.id); return <div key={certificate.id} style={{ marginBottom: "8px" }}><label className="check-field"><input type="radio" name={`system-${group.type}`} checked={isCertSelected} onChange={() => { setSelectedExportIds((current) => [...current.filter((id) => !group.certificates.some((item) => item.id === id)), certificate.id]); setSelectedFileIds((cur) => Array.from(new Set([...cur, certificate.document.id]))); }} /><b>{certificate.title ? `${group.displayName} (${certificate.title})` : group.displayName}</b> · {certificate.expiryDate ? `Hết hạn ${formatExpiry(certificate.expiryDate)}` : "Không thời hạn"}</label>{isCertSelected && scanTree(certificate)}</div>; }) : <span className="muted">Không có chứng chỉ còn hạn</span>}</fieldset>)}{exportChoices && exportChoices.extra.length > 0 && <fieldset className="export-cert-group"><legend>Chứng chỉ tự thêm</legend>{exportChoices.extra.map((certificate) => { const isCertSelected = extraExportIds.includes(certificate.id); return <div key={certificate.id} style={{ marginBottom: "8px" }}><label className="check-field"><input type="checkbox" checked={isCertSelected} onChange={(event) => { const checked = event.target.checked; setExtraExportIds((current) => checked ? [...current, certificate.id] : current.filter((id) => id !== certificate.id)); if (checked) setSelectedFileIds((cur) => Array.from(new Set([...cur, certificate.document.id]))); }} /><b>{certificateTypes.find((type) => type.key === certificate.type)?.name ?? "Chứng chỉ"}{certificate.title ? ` (${certificate.title})` : ""}</b> · {certificate.expiryDate ? `Hết hạn ${formatExpiry(certificate.expiryDate)}` : "Không thời hạn"}</label>{isCertSelected && scanTree(certificate)}</div>; })}</fieldset>}{exportReadiness && exportReadiness.errors.length > 0 && <div className="readiness-errors"><b>Thông tin cần sửa trước khi xuất</b>{exportReadiness.errors.map((item, index) => <p key={`${item.field}-${index}`}>{readinessFieldLabel(item.field)}: {issueText(item.code)} <button className="button" onClick={props.onEditProfile}>Mở biểu mẫu sửa</button></p>)}</div>}{exportReadiness && exportReadiness.warnings.length > 0 && <div className="readiness-warnings">{exportReadiness.warnings.map((code) => <p key={code}>{issueText(code)}</p>)}</div>}<p>Tóm tắt: {exportPageCount === null ? "1 trang phiếu bìa; số trang scan sẽ xác định khi tạo" : `${exportPageCount} trang PDF`}</p></div><footer><button className="button" onClick={props.onClose}>Đóng</button><button className="button primary" disabled={exportBusy || !exportSignerId || Boolean(exportReadiness?.errors.length)} onClick={() => void createProfilePdf()}>{exportBusy ? "Đang tạo PDF…" : "Tải PDF"}</button></footer></section></div>;
}
