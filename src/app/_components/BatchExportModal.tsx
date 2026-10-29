import { useEffect, useMemo, useState } from "react";
import { FileArchive, FileDown, FileText, X } from "lucide-react";
import { systemClock, todayVN } from "../../lib/clock";
import { can, type Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import { ContactPicker, EMPTY_CONTACT, type ContactChoice } from "./ContactPicker";
import { SignerPicker, type ChosenSigner, type SignatureFileLoader } from "./SignerPicker";
import { usesSigner } from "../../modules/excel-template/engine/profileConfig";
import type { Employee } from "../../modules/employees/types";
import type { CertificateExportConfig, ExcelReportTemplate, ProfileTemplateConfig } from "../../modules/excel-template/types";
import { certificateRootFolderName } from "../../modules/excel-template/certificateExportNames";
import { CertificateExportNaming } from "./CertificateExportNaming";
import { downloadBlob, downloadXlsx, exportCertificateFiles, exportCertificatesPdf, mergesCertificates, exportProfileBundle, exportProfilePdf, exportProfileWorkbook, isConverterMissing, profileFileName, zipFileName, zipFiles, type ProfileBundleFile } from "./profileExport";
import type { App, SetNotice } from "./shared";
import { expirySortKey, isValidOn } from "../../modules/certificates/status";

type ProfileTemplate = ExcelReportTemplate & { profile: ProfileTemplateConfig };
type PersonResult = { employee: Employee; warnings: string[]; error?: string };

/**
 * Xuất "Mẫu hồ sơ" cho một hoặc nhiều nhân sự: giá trị chung nhập một lần, sửa riêng cho người khác biệt;
 * một người → tệp .xlsx, nhiều người → một tệp .zip.
 */
export function BatchExportModal(props: { app: App; actor: Actor; employees: readonly Employee[]; templates: readonly ExcelReportTemplate[]; sessionFiles: Readonly<Record<string, File>>; ensureFiles?: (certificates: readonly Certificate[], employee: Employee) => Promise<Readonly<Record<string, File>>>; onClose: () => void; onGoToTemplates: () => void; setNotice: SetNotice; loadSignatureFile?: SignatureFileLoader | undefined; onSaveNaming?: ((templateId: string, patch: Pick<ProfileTemplateConfig, "fileNamePattern" | "certificateExport">) => void) | undefined }) {
  const { app, actor, employees, sessionFiles, setNotice } = props;
  const profileTemplates = useMemo(() => props.templates.filter((template): template is ProfileTemplate => Boolean(template.profile)), [props.templates]);
  const defaultsOf = (item: ProfileTemplate | undefined) => Object.fromEntries((item?.profile.customFields ?? []).map((field) => [field.key, field.defaultValue]));
  const [templateId, setTemplateId] = useState(profileTemplates[0]?.id ?? "");
  const template = profileTemplates.find((item) => item.id === templateId);
  const exportDate = todayVN(systemClock);
  const [shared, setShared] = useState<Record<string, string>>(() => defaultsOf(profileTemplates[0]));
  const [perPerson, setPerPerson] = useState<Record<string, Record<string, string>>>({});
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [contactChoice, setContactChoice] = useState<ContactChoice>(EMPTY_CONTACT);
  const [contact, setContact] = useState<Commander | null>(null);
  const [signer, setSigner] = useState<ChosenSigner>(null);
  const employeeIds = useMemo(() => employees.map((employee) => employee.id), [employees]);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | "certs" | null>(null);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PersonResult[] | null>(null);
  /** Quy tắc tên khi tải riêng chứng chỉ (thư mục nhân sự = quy tắc đặt tên tệp của mẫu); Admin đổi thì lưu vào mẫu. */
  const [namePattern, setNamePattern] = useState(profileTemplates[0]?.profile.fileNamePattern ?? "");
  const [certConfig, setCertConfig] = useState<CertificateExportConfig | undefined>(profileTemplates[0]?.profile.certificateExport);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});

  // Đổi mẫu → nạp lại giá trị chung mặc định của mẫu đó
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    setShared(defaultsOf(profileTemplates.find((item) => item.id === id)));
    setPerPerson({});
    setResults(null);
    const next = profileTemplates.find((item) => item.id === id)?.profile;
    setNamePattern(next?.fileNamePattern ?? "");
    setCertConfig(next?.certificateExport);
  };

  useEffect(() => {
    let active = true;
    void app.certificateTypes.list(actor, true).then((types) => { if (active && types.ok) setTypeNames(Object.fromEntries(types.value.map((type) => [type.key, type.name]))); });
    return () => { active = false; };
  }, [app, actor]);

  /** Chỉ chứng chỉ còn hạn theo danh sách của mẫu, không kèm phiếu: <thư mục tổng>/<thư mục từng nhân sự>/1. …, 2. … */
  const runCertificates = async () => {
    if (!template) return;
    setBusy("certs"); setProgress(0); setResults(null);
    if (can(actor, "export") && (namePattern.trim() !== (template.profile.fileNamePattern ?? "").trim() || JSON.stringify(certConfig ?? {}) !== JSON.stringify(template.profile.certificateExport ?? {}))) {
      props.onSaveNaming?.(template.id, { fileNamePattern: namePattern.trim(), ...(certConfig ? { certificateExport: certConfig } : {}) });
    }
    try {
      const { attachments } = template.profile;
      const rank = (type: string) => attachments.indexOf(type);
      const outcomes: PersonResult[] = [];
      const output: (ProfileBundleFile & { folder: string })[] = [];
      const merged = mergesCertificates(certConfig);
      for (const [index, employee] of employees.entries()) {
        try {
          const certificates = await app.certificates.listByEmployee(actor, employee.id);
          const list = (certificates.ok ? certificates.value : [])
            .filter((item) => item.state === "current" && isValidOn(item.expiryDate, exportDate) && attachments.includes(item.type))
            .sort((a, b) => rank(a.type) - rank(b.type) || expirySortKey(a.expiryDate).localeCompare(expirySortKey(b.expiryDate)));
          const files = props.ensureFiles ? await props.ensureFiles(list, employee) : sessionFiles;
          const exportInput = { employee, certificates: list, certificateTypeNames: typeNames, sessionFiles: files, config: certConfig, fileNamePattern: namePattern, exportDate };
          if (merged) {
            // Mỗi nhân sự MỘT tệp PDF gộp mọi chứng chỉ; trùng tên tệp (vd quy tắc chỉ có tên) → thêm mã
            const pdf = await exportCertificatesPdf(exportInput);
            const name = output.some((file) => file.name.toLowerCase() === pdf.name.toLowerCase()) ? pdf.name.replace(/\.pdf$/, ` (${employee.code}).pdf`) : pdf.name;
            if (pdf.pageCount) output.push({ name, bytes: pdf.bytes, folder: "" });
            outcomes.push(pdf.pageCount ? { employee, warnings: pdf.warnings } : { employee, warnings: [], error: pdf.warnings[0] ?? "Không có tệp chứng chỉ nào." });
          } else {
            const result = await exportCertificateFiles(exportInput);
            // Hai nhân sự trùng tên thư mục (vd quy tắc chỉ có tên) → thêm mã để không ghi đè lên nhau
            const folder = output.some((file) => file.folder === result.folder) ? `${result.folder} (${employee.code})` : result.folder;
            output.push(...result.files.map((file) => ({ ...file, folder })));
            outcomes.push(result.files.length ? { employee, warnings: result.warnings } : { employee, warnings: [], error: result.warnings[0] ?? "Không có tệp chứng chỉ nào." });
          }
        } catch (error) {
          outcomes.push({ employee, warnings: [], error: error instanceof Error ? error.message : "Không tạo được tệp chứng chỉ." });
        }
        setProgress(index + 1);
      }
      const done = outcomes.filter((item) => !item.error).length;
      const root = certificateRootFolderName(certConfig, { templateName: template.name, count: done, exportDate });
      // Gộp PDF mà chỉ một người → tải thẳng tệp PDF; còn lại nén ZIP <thư mục tổng>/…
      if (merged && output.length === 1) downloadBlob(new Blob([output[0]!.bytes.slice().buffer], { type: "application/pdf" }), output[0]!.name);
      else if (output.length) downloadBlob(await zipFiles(output.map((file) => ({ ...file, folder: file.folder ? `${root}/${file.folder}` : root }))), `${root}.zip`);
      setResults(outcomes);
      const failed = outcomes.length - done;
      setNotice(failed ? `Đã tải chứng chỉ của ${done}/${employees.length} nhân sự, ${failed} người không có tệp.` : `Đã tải chứng chỉ của ${done} nhân sự.`);
    } finally { setBusy(null); }
  };

  const fields = (template?.profile.customFields ?? []).filter((field) => field.kind !== "image" && field.scope !== "employee");
  const setPersonValue = (employeeId: string, key: string, value: string) => setPerPerson((current) => ({ ...current, [employeeId]: { ...current[employeeId], [key]: value } }));

  const run = async (format: "xlsx" | "pdf") => {
    if (!template) return;
    setBusy(format); setProgress(0); setResults(null);
    try {
      const types = await app.certificateTypes.list(actor, true);
      const typeNames = types.ok ? Object.fromEntries(types.value.map((type) => [type.key, type.name])) : {};
      const outcomes: PersonResult[] = [];
      const output: (ProfileBundleFile & { folder?: string })[] = [];
      // Chưa cài máy chuyển PDF thì biết ngay ở người đầu tiên, những người sau xuất thẳng bộ ZIP
      let converterReady = true;
      for (const [index, employee] of employees.entries()) {
        try {
          const certificates = await app.certificates.listByEmployee(actor, employee.id);
          const list = certificates.ok ? certificates.value : [];
          const files = props.ensureFiles ? await props.ensureFiles(list, employee) : sessionFiles;
          let full = employee;
          if (template.profile.placeholders.includes("cccd")) {
            const revealed = await app.employees.revealCccd(actor, employee.id);
            if (revealed.ok) full = { ...employee, cccd: revealed.value };
          }
          const selected = includeAttachments ? list.filter((item) => item.state === "current" && isValidOn(item.expiryDate, exportDate) && template.profile.attachments.includes(item.type)).map((item) => item.id) : [];
          const overrides = { ...shared, ...Object.fromEntries(Object.entries(perPerson[employee.id] ?? {}).filter(([, value]) => value !== "")) };
          const input = { template, employee: full, commander: contact, signer: usesSigner(template.profile) ? signer : null, certificates: list, certificateTypeNames: typeNames, sessionFiles: files, selectedCertificateIds: selected, overrides, exportDate };
          if (format === "pdf" && converterReady) {
            // Mỗi nhân sự một file PDF: phiếu rồi các chứng chỉ ở dưới
            try {
              const result = await exportProfilePdf(input);
              output.push({ name: profileFileName(employee, exportDate, "pdf", namePattern), bytes: result.bytes });
              outcomes.push({ employee, warnings: result.warnings });
            } catch (error) {
              if (!isConverterMissing(error)) throw error;
              converterReady = false;
            }
          }
          if (format === "pdf" && !converterReady) {
            // Chưa cài máy chuyển PDF: mỗi nhân sự một thư mục gồm phiếu Excel + PDF gộp chứng chỉ
            const result = await exportProfileBundle(input);
            const folder = profileFileName(employee, exportDate, "xlsx", namePattern).replace(/\.xlsx$/, "");
            output.push(...result.files.map((file) => ({ ...file, folder })));
            outcomes.push({ employee, warnings: ["Máy chủ chưa cài máy chuyển PDF nên phiếu vẫn là file Excel", ...result.warnings] });
          } else if (format === "xlsx") {
            const result = await exportProfileWorkbook(input);
            output.push({ name: profileFileName(employee, exportDate, "xlsx", namePattern), bytes: result.bytes });
            outcomes.push({ employee, warnings: result.warnings });
          }
        } catch (error) {
          outcomes.push({ employee, warnings: [], error: error instanceof Error ? error.message : "Không tạo được hồ sơ." });
        }
        setProgress(index + 1);
      }
      const done = outcomes.filter((item) => !item.error).length;
      if (format === "pdf" && output.length === 1 && output[0]!.name.endsWith(".pdf")) downloadBlob(new Blob([output[0]!.bytes.slice().buffer], { type: "application/pdf" }), output[0]!.name);
      else if (format === "pdf" && done === 1) downloadBlob(await zipFiles(output.map(({ name, bytes }) => ({ name, bytes }))), profileFileName(outcomes.find((item) => !item.error)!.employee, exportDate, "zip", namePattern));
      else if (format === "xlsx" && output.length === 1) downloadXlsx(output[0]!.bytes, output[0]!.name);
      else if (output.length) downloadBlob(await zipFiles(output), zipFileName(template.name, exportDate, done));
      setResults(outcomes);
      const failed = outcomes.filter((item) => item.error).length;
      const needCheck = outcomes.filter((item) => item.warnings.length).length;
      setNotice(failed ? `Đã xuất ${done}/${employees.length} hồ sơ, ${failed} hồ sơ không tạo được.` : needCheck ? `Đã xuất ${done} hồ sơ, ${needCheck} hồ sơ còn mục cần kiểm tra.` : `Đã xuất ${done} hồ sơ.`);
    } finally { setBusy(null); }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card batch-export" role="dialog" aria-modal="true" aria-labelledby="batch-export-title">
        <header>
          <h2 id="batch-export-title">Xuất hồ sơ · {employees.length} nhân sự</h2>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="batch-export-body">
          {!profileTemplates.length ? (
            <div className="empty-state">
              <p>Chưa có mẫu hồ sơ nào. Tạo mẫu trong FORM Báo cáo trước.</p>
              <button type="button" className="button primary" onClick={props.onGoToTemplates}>Mở FORM Báo cáo</button>
            </div>
          ) : <>
            <label className="field">
              <span>Mẫu hồ sơ</span>
              <select value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
                {profileTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>

            <ContactPicker app={app} actor={actor} value={contactChoice} preferredIds={employeeIds} onChange={(value, next) => { setContactChoice(value); setContact(next); }} />
            {template && usesSigner(template.profile) && <SignerPicker key={template.id} app={app} actor={actor} loadFile={props.loadSignatureFile} onChange={setSigner} preferredId={template.profile.signatureId} />}

            {fields.length > 0 && (
              <section>
                <h3>Giá trị chung cho cả dự án</h3>
                <div className="form-grid batch-fields">
                  {fields.map((field) => field.kind === "checkbox"
                    ? <label className="check-field" key={field.key}><input type="checkbox" checked={shared[field.key] === "true"} onChange={(event) => setShared({ ...shared, [field.key]: event.target.checked ? "true" : "" })} /> {field.label}</label>
                    : <label className="field" key={field.key}><span>{field.label}</span><input type={field.kind === "date" ? "date" : "text"} value={shared[field.key] ?? ""} onChange={(event) => setShared({ ...shared, [field.key]: event.target.value })} /></label>)}
                </div>
              </section>
            )}

            <section>
              <h3>Danh sách xuất {fields.length > 0 && <small>· để trống là dùng giá trị chung</small>}</h3>
              <div className="table-scroll batch-table-wrap">
                <table className="batch-table">
                  <thead><tr><th>Mã</th><th>Họ và tên</th>{fields.filter((field) => field.kind !== "checkbox").map((field) => <th key={field.key}>{field.label} (riêng)</th>)}<th>Kết quả</th></tr></thead>
                  <tbody>
                    {employees.map((employee) => {
                      const outcome = results?.find((item) => item.employee.id === employee.id);
                      return (
                        <tr key={employee.id}>
                          <td>{employee.code}</td>
                          <td>{employee.name}</td>
                          {fields.filter((field) => field.kind !== "checkbox").map((field) => (
                            <td key={field.key}><input aria-label={`${field.label} riêng cho ${employee.name}`} type={field.kind === "date" ? "date" : "text"} value={perPerson[employee.id]?.[field.key] ?? ""} onChange={(event) => setPersonValue(employee.id, field.key, event.target.value)} /></td>
                          ))}
                          <td>{!outcome ? <span className="muted">—</span> : outcome.error ? <span className="pill bad" title={outcome.error}>Lỗi</span> : outcome.warnings.length ? <span className="pill warn" title={outcome.warnings.join("\n")}>{outcome.warnings.length} mục cần kiểm tra</span> : <span className="pill ok">Đầy đủ</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <label className="check-field"><input type="checkbox" checked={includeAttachments} onChange={(event) => setIncludeAttachments(event.target.checked)} /> Đính kèm chứng chỉ còn hạn theo danh sách của mẫu (PDF gộp nhận cả tệp PDF; Excel chỉ nhận ảnh)</label>

            {template && (
              <details className="file-name-rule certificate-naming-box">
                <summary>Cách tải riêng chứng chỉ (1 PDF mỗi người hoặc từng tệp) và đặt tên</summary>
                <CertificateExportNaming value={certConfig} onChange={setCertConfig} typeKeys={template.profile.attachments} typeNames={typeNames} fileNamePattern={namePattern} onFileNamePatternChange={setNamePattern} templateName={template.name} exportDate={exportDate} person={employees[0]} count={employees.length} />
              </details>
            )}

            {results && results.some((item) => item.warnings.length || item.error) && (
              <details className="batch-warnings">
                <summary>Chi tiết các mục cần kiểm tra</summary>
                {results.filter((item) => item.warnings.length || item.error).map((item) => (
                  <div key={item.employee.id}>
                    <b>{item.employee.code} · {item.employee.name}</b>
                    <ul>{item.error ? <li>{item.error}</li> : item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                ))}
              </details>
            )}
          </>}
        </div>
        <footer>
          {busy && <span className="batch-progress" role="status">Đang tạo {progress}/{employees.length}…<progress max={employees.length} value={progress} /></span>}
          <button type="button" className="button" onClick={props.onClose}>Đóng</button>
          <button type="button" className="button" disabled={busy !== null || !template || !employees.length} title={mergesCertificates(certConfig) ? "Chứng chỉ còn hạn theo danh sách của mẫu, mỗi nhân sự gộp thành một tệp PDF, không kèm phiếu" : "Chỉ chứng chỉ còn hạn theo danh sách của mẫu, mỗi chứng chỉ một tệp đánh số, không kèm phiếu"} onClick={() => void runCertificates()}>
            <FileArchive className="ico" size={16} aria-hidden="true" />
            {mergesCertificates(certConfig) ? (employees.length > 1 ? `Tải chứng chỉ · ${employees.length} PDF (.zip)` : "Tải chứng chỉ (1 PDF)") : "Tải chứng chỉ (.zip)"}
          </button>
          <button type="button" className="button" disabled={busy !== null || !template || !employees.length} onClick={() => void run("xlsx")}>
            <FileDown className="ico" size={16} aria-hidden="true" />
            {employees.length > 1 ? `Tải Excel · ${employees.length} hồ sơ (.zip)` : "Tải Excel (.xlsx)"}
          </button>
          <button type="button" className="button primary" disabled={busy !== null || !template || !employees.length} onClick={() => void run("pdf")}>
            <FileText className="ico" size={16} aria-hidden="true" />
            {employees.length > 1 ? `Tải hồ sơ PDF · ${employees.length} hồ sơ (.zip)` : "Tải hồ sơ PDF"}
          </button>
        </footer>
      </section>
    </div>
  );
}
