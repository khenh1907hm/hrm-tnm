import { useMemo, useState } from "react";
import JSZip from "jszip";
import { FileDown, FileText, X } from "lucide-react";
import { systemClock, todayVN } from "../../lib/clock";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import { ContactPicker, EMPTY_CONTACT, type ContactChoice } from "./ContactPicker";
import type { Employee } from "../../modules/employees/types";
import type { ExcelReportTemplate, ProfileTemplateConfig } from "../../modules/excel-template/types";
import { downloadBlob, downloadPdf, downloadXlsx, exportProfilePdf, exportProfileWorkbook, profileFileName, zipFileName } from "./profileExport";
import type { App, SetNotice } from "./shared";

type ProfileTemplate = ExcelReportTemplate & { profile: ProfileTemplateConfig };
type PersonResult = { employee: Employee; warnings: string[]; error?: string };

/**
 * Xuất "Mẫu hồ sơ" cho một hoặc nhiều nhân sự: giá trị chung nhập một lần, sửa riêng cho người khác biệt;
 * một người → tệp .xlsx, nhiều người → một tệp .zip.
 */
export function BatchExportModal(props: { app: App; actor: Actor; employees: readonly Employee[]; templates: readonly ExcelReportTemplate[]; sessionFiles: Readonly<Record<string, File>>; ensureFiles?: (certificates: readonly Certificate[], employee: Employee) => Promise<Readonly<Record<string, File>>>; onClose: () => void; onGoToTemplates: () => void; setNotice: SetNotice;
  /** Thiết lập sẵn từ dự án: mẫu, chỉ huy trưởng, giá trị trường nhập khi xuất. */
  preset?: { title: string; templateId: string | null; contact: ContactChoice; values: Record<string, string> } }) {
  const { app, actor, employees, sessionFiles, setNotice } = props;
  const profileTemplates = useMemo(() => props.templates.filter((template): template is ProfileTemplate => Boolean(template.profile)), [props.templates]);
  const defaultsOf = (item: ProfileTemplate | undefined) => Object.fromEntries((item?.profile.customFields ?? []).map((field) => [field.key, field.defaultValue]));
  const presetTemplate = profileTemplates.find((item) => item.id === props.preset?.templateId);
  const [templateId, setTemplateId] = useState(presetTemplate?.id ?? profileTemplates[0]?.id ?? "");
  const template = profileTemplates.find((item) => item.id === templateId);
  const exportDate = todayVN(systemClock);
  const [shared, setShared] = useState<Record<string, string>>(() => ({ ...defaultsOf(presetTemplate ?? profileTemplates[0]), ...(presetTemplate ? props.preset?.values : {}) }));
  const [perPerson, setPerPerson] = useState<Record<string, Record<string, string>>>({});
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [contactChoice, setContactChoice] = useState<ContactChoice>(props.preset?.contact ?? EMPTY_CONTACT);
  const [contact, setContact] = useState<Commander | null>(null);
  const employeeIds = useMemo(() => employees.map((employee) => employee.id), [employees]);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PersonResult[] | null>(null);

  // Đổi mẫu → nạp lại giá trị chung mặc định của mẫu đó
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    setShared(defaultsOf(profileTemplates.find((item) => item.id === id)));
    setPerPerson({});
    setResults(null);
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
      const output: { name: string; bytes: Uint8Array }[] = [];
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
          const selected = includeAttachments ? list.filter((item) => item.state === "current" && item.expiryDate >= exportDate && template.profile.attachments.includes(item.type)).map((item) => item.id) : [];
          const overrides = { ...shared, ...Object.fromEntries(Object.entries(perPerson[employee.id] ?? {}).filter(([, value]) => value !== "")) };
          const input = { template, employee: full, commander: contact, certificates: list, certificateTypeNames: typeNames, sessionFiles: files, selectedCertificateIds: selected, overrides, exportDate };
          const result = format === "pdf" ? await exportProfilePdf(input) : await exportProfileWorkbook(input);
          output.push({ name: profileFileName(employee, exportDate, format), bytes: result.bytes });
          outcomes.push({ employee, warnings: result.warnings });
        } catch (error) {
          outcomes.push({ employee, warnings: [], error: error instanceof Error ? error.message : "Không tạo được hồ sơ." });
        }
        setProgress(index + 1);
      }
      if (output.length === 1) (format === "pdf" ? downloadPdf : downloadXlsx)(output[0]!.bytes, output[0]!.name);
      else if (output.length > 1) {
        const zip = new JSZip();
        for (const file of output) zip.file(file.name, file.bytes);
        downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), zipFileName(props.preset?.title ?? template.name, exportDate, output.length));
      }
      setResults(outcomes);
      const failed = outcomes.filter((item) => item.error).length;
      const needCheck = outcomes.filter((item) => item.warnings.length).length;
      setNotice(failed ? `Đã xuất ${output.length}/${employees.length} hồ sơ, ${failed} hồ sơ không tạo được.` : needCheck ? `Đã xuất ${output.length} hồ sơ, ${needCheck} hồ sơ còn mục cần kiểm tra.` : `Đã xuất ${output.length} hồ sơ.`);
    } finally { setBusy(null); }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card batch-export" role="dialog" aria-modal="true" aria-labelledby="batch-export-title">
        <header>
          <h2 id="batch-export-title">{props.preset ? `Xuất hồ sơ dự án · ${props.preset.title}` : "Xuất hồ sơ"} · {employees.length} nhân sự</h2>
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

            {fields.length > 0 && (
              <section>
                <h3>Giá trị chung cho cả lô</h3>
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
          <button type="button" className="button" disabled={busy !== null || !template || !employees.length} onClick={() => void run("xlsx")}>
            <FileDown className="ico" size={16} aria-hidden="true" />
            {employees.length > 1 ? `Tải Excel · ${employees.length} hồ sơ (.zip)` : "Tải Excel (.xlsx)"}
          </button>
          <button type="button" className="button primary" disabled={busy !== null || !template || !employees.length} onClick={() => void run("pdf")}>
            <FileText className="ico" size={16} aria-hidden="true" />
            {employees.length > 1 ? `Tải PDF gộp · ${employees.length} hồ sơ (.zip)` : "Tải PDF gộp"}
          </button>
        </footer>
      </section>
    </div>
  );
}
