import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { systemClock, todayVN } from "../../lib/clock";
import { normalizeText } from "../../lib/text";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import type { ExcelReportTemplate, ProfileTemplateConfig } from "../../modules/excel-template/types";
import { downloadXlsx, exportProfileWorkbook } from "./profileExport";
import type { App, SetNotice } from "./shared";

type ProfileTemplate = ExcelReportTemplate & { profile: ProfileTemplateConfig };

/** Xuất "Mẫu hồ sơ" cho một nhân sự: nhập trường tùy chỉnh, chọn chứng chỉ, xem cảnh báo. */
export function ProfileExportForm(props: { app: App; actor: Actor; template: ProfileTemplate; employee: Employee; certificates: readonly Certificate[]; sessionFiles: Readonly<Record<string, File>>; setNotice: SetNotice }) {
  const { app, actor, template, employee, certificates } = props;
  const { profile } = template;
  const exportDate = todayVN(systemClock);
  const [overrides, setOverrides] = useState<Record<string, string>>(() => Object.fromEntries(profile.customFields.map((field) => [field.key, field.defaultValue])));
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [commander, setCommander] = useState<Commander | null>(null);
  const current = useMemo(() => certificates.filter((certificate) => certificate.state === "current"), [certificates]);
  const [selected, setSelected] = useState<string[]>(() => current.filter((certificate) => certificate.expiryDate >= exportDate && profile.attachments.includes(certificate.type)).map((certificate) => certificate.id));
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([app.certificateTypes.list(actor, true), app.commanders.list(actor, true)]).then(([types, commanders]) => {
      if (!active) return;
      if (types.ok) setTypeNames(Object.fromEntries(types.value.map((type) => [type.key, type.name])));
      if (commanders.ok) setCommander(commanders.value.find((item) => item.id === employee.emergencyContactId) ?? null);
    });
    return () => { active = false; };
  }, [app, actor, employee.emergencyContactId]);

  const ordered = [...current].sort((a, b) => {
    const rank = (type: string) => { const index = profile.attachments.indexOf(type); return index < 0 ? 99 : index; };
    return rank(a.type) - rank(b.type) || a.expiryDate.localeCompare(b.expiryDate);
  });

  const run = async () => {
    setBusy(true);
    try {
      // CCCD trong hồ sơ đang bị che; chỉ mở khi mẫu thật sự cần (có ghi nhật ký)
      let fullEmployee = employee;
      if (profile.placeholders.includes("cccd")) {
        const revealed = await app.employees.revealCccd(actor, employee.id);
        if (revealed.ok) fullEmployee = { ...employee, cccd: revealed.value };
      }
      const result = await exportProfileWorkbook({ template, employee: fullEmployee, commander, certificates, certificateTypeNames: typeNames, sessionFiles: props.sessionFiles, selectedCertificateIds: selected, overrides, exportDate });
      const name = normalizeText(employee.name).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
      downloadXlsx(result.bytes, `HoSo_${employee.code}_${name}_${exportDate.replaceAll("-", "")}.xlsx`);
      setWarnings(result.warnings);
      props.setNotice(result.warnings.length ? `Đã tải hồ sơ Excel, còn ${result.warnings.length} mục cần kiểm tra.` : "Đã tải hồ sơ Excel.");
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "Không tạo được hồ sơ Excel.");
    } finally { setBusy(false); }
  };

  return (
    <div className="profile-export">
      {profile.customFields.length > 0 && (
        <section>
          <h3>Thông tin theo dự án</h3>
          <div className="form-grid profile-export-fields">
            {profile.customFields.map((field) => field.kind === "checkbox"
              ? <label className="check-field" key={field.key}><input type="checkbox" checked={overrides[field.key] === "true"} onChange={(event) => setOverrides({ ...overrides, [field.key]: event.target.checked ? "true" : "" })} /> {field.label}</label>
              : <label className="field" key={field.key}><span>{field.label}</span><input type={field.kind === "date" ? "date" : "text"} value={overrides[field.key] ?? ""} onChange={(event) => setOverrides({ ...overrides, [field.key]: event.target.value })} /></label>)}
          </div>
        </section>
      )}
      <section>
        <h3>Chứng chỉ đính kèm (lần lượt sau phiếu, mỗi chứng chỉ một trang)</h3>
        {ordered.length ? ordered.map((certificate) => {
          const hasBinary = Boolean(props.sessionFiles[certificate.document.id]);
          const expired = certificate.expiryDate < exportDate;
          return (
            <label className="check-field profile-export-cert" key={certificate.id}>
              <input type="checkbox" checked={selected.includes(certificate.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, certificate.id] : selected.filter((id) => id !== certificate.id))} />
              <span><b>{typeNames[certificate.type] ?? certificate.type}{certificate.title ? ` (${certificate.title})` : ""}</b> · Số {certificate.number} · Hết hạn {certificate.expiryDate.split("-").reverse().join("/")}</span>
              {expired && <span className="pill bad">Đã hết hạn</span>}
              {!profile.attachments.includes(certificate.type) && <span className="pill">Ngoài danh sách của mẫu</span>}
              {!hasBinary && <span className="pill warn">Chưa có tệp trong phiên</span>}
            </label>
          );
        }) : <p className="muted">Nhân sự chưa có chứng chỉ hiện hành.</p>}
      </section>
      {warnings && warnings.length > 0 && (
        <div className="readiness-warnings">
          <b>Đã xuất, nhưng còn {warnings.length} mục để trống hoặc chưa đính kèm được:</b>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="button primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Đang tạo hồ sơ…" : <><Download className="ico" size={16} aria-hidden="true" /> Tải hồ sơ Excel (.xlsx)</>}
        </button>
      </div>
    </div>
  );
}
