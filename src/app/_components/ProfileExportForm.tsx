import { Download, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { systemClock, todayVN } from "../../lib/clock";
import type { Actor } from "../../modules/auth/permissions";
import type { Certificate } from "../../modules/certificates/types";
import type { Commander } from "../../modules/commanders/types";
import { ContactPicker, EMPTY_CONTACT, type ContactChoice } from "./ContactPicker";
import { SignerPicker, type ChosenSigner, type SignatureFileLoader } from "./SignerPicker";
import { usesSigner } from "../../modules/excel-template/engine/profileConfig";
import type { Employee } from "../../modules/employees/types";
import type { ExcelReportTemplate, ProfileTemplateConfig } from "../../modules/excel-template/types";
import { downloadBlob, downloadXlsx, exportProfileBundle, exportProfileWorkbook, profileFileName, zipFiles } from "./profileExport";
import type { App, SetNotice } from "./shared";

type ProfileTemplate = ExcelReportTemplate & { profile: ProfileTemplateConfig };

/** Xuất "Mẫu hồ sơ" cho một nhân sự: nhập trường tùy chỉnh, chọn chứng chỉ, xem cảnh báo. */
export function ProfileExportForm(props: { app: App; actor: Actor; template: ProfileTemplate; employee: Employee; certificates: readonly Certificate[]; sessionFiles: Readonly<Record<string, File>>; setNotice: SetNotice; loadSignatureFile?: SignatureFileLoader | undefined; pdfOnly?: boolean }) {
  const { app, actor, template, employee, certificates } = props;
  const { profile } = template;
  const exportDate = todayVN(systemClock);
  const exportFields = profile.customFields.filter((field) => field.kind !== "image" && field.scope !== "employee");
  const [overrides, setOverrides] = useState<Record<string, string>>(() => Object.fromEntries(exportFields.map((field) => [field.key, field.defaultValue])));
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [commander, setCommander] = useState<Commander | null>(null);
  const [signer, setSigner] = useState<ChosenSigner>(null);
  const needsSigner = usesSigner(profile);
  const [contactChoice, setContactChoice] = useState<ContactChoice>(EMPTY_CONTACT);
  const selfIds = useMemo(() => [employee.id], [employee.id]);
  const current = useMemo(() => certificates.filter((certificate) => certificate.state === "current"), [certificates]);
  const [selected, setSelected] = useState<string[]>(() => current.filter((certificate) => certificate.expiryDate >= exportDate && profile.attachments.includes(certificate.type)).map((certificate) => certificate.id));
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void app.certificateTypes.list(actor, true).then((types) => {
      if (!active) return;
      if (types.ok) setTypeNames(Object.fromEntries(types.value.map((type) => [type.key, type.name])));
    });
    return () => { active = false; };
  }, [app, actor]);

  const ordered = [...current].sort((a, b) => {
    const rank = (type: string) => { const index = profile.attachments.indexOf(type); return index < 0 ? 99 : index; };
    return rank(a.type) - rank(b.type) || a.expiryDate.localeCompare(b.expiryDate);
  });

  const run = async (format: "xlsx" | "pdf") => {
    setBusy(format);
    try {
      // CCCD trong hồ sơ đang bị che; chỉ mở khi mẫu thật sự cần (có ghi nhật ký)
      let fullEmployee = employee;
      if (profile.placeholders.includes("cccd")) {
        const revealed = await app.employees.revealCccd(actor, employee.id);
        if (revealed.ok) fullEmployee = { ...employee, cccd: revealed.value };
      }
      const input = { template, employee: fullEmployee, commander, signer: needsSigner ? signer : null, certificates, certificateTypeNames: typeNames, sessionFiles: props.sessionFiles, selectedCertificateIds: selected, overrides, exportDate };
      const label = format === "pdf" ? "ZIP (Excel + PDF chứng chỉ)" : "Excel";
      let warningList: string[];
      if (format === "pdf") {
        const result = await exportProfileBundle(input);
        downloadBlob(await zipFiles(result.files), profileFileName(employee, exportDate, "zip"));
        warningList = result.warnings;
      } else {
        const result = await exportProfileWorkbook(input);
        downloadXlsx(result.bytes, profileFileName(employee, exportDate));
        warningList = result.warnings;
      }
      setWarnings(warningList);
      props.setNotice(warningList.length ? `Đã tải hồ sơ ${label}, còn ${warningList.length} mục cần kiểm tra.` : `Đã tải hồ sơ ${label}.`, warningList.length ? "warning" : "success");
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "Không tạo được hồ sơ.", "error");
    } finally { setBusy(null); }
  };

  return (
    <div className="profile-export">
      <ContactPicker app={app} actor={actor} value={contactChoice} preferredIds={selfIds} onChange={(value, next) => { setContactChoice(value); setCommander(next); }} />
      {needsSigner && <SignerPicker app={app} actor={actor} loadFile={props.loadSignatureFile} onChange={setSigner} preferredId={profile.signatureId} />}
      {exportFields.length > 0 && (
        <section>
          <h3>Thông tin theo dự án</h3>
          <div className="form-grid profile-export-fields">
            {exportFields.map((field) => field.kind === "checkbox"
              ? <label className="check-field" key={field.key}><input type="checkbox" checked={overrides[field.key] === "true"} onChange={(event) => setOverrides({ ...overrides, [field.key]: event.target.checked ? "true" : "" })} /> {field.label}</label>
              : <label className="field" key={field.key}><span>{field.label}</span><input type={field.kind === "date" ? "date" : "text"} value={overrides[field.key] ?? ""} onChange={(event) => setOverrides({ ...overrides, [field.key]: event.target.value })} /></label>)}
          </div>
        </section>
      )}
      <section>
        <h3>Chứng chỉ đính kèm (ghép lần lượt sau phiếu)</h3>
        <p className="muted">Hồ sơ PDF (.zip): phiếu Excel đã điền + một tệp PDF gộp các chứng chỉ (PDF giữ nguyên trang, ảnh scan mỗi ảnh một trang A4). Excel: chỉ chèn được chứng chỉ dạng ảnh.</p>
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
        {!props.pdfOnly && <button type="button" className="button" disabled={busy !== null} onClick={() => void run("xlsx")}>
          {busy === "xlsx" ? "Đang tạo Excel…" : <><Download className="ico" size={16} aria-hidden="true" /> Tải Excel (.xlsx)</>}
        </button>}
        <button type="button" className="button primary" disabled={busy !== null} onClick={() => void run("pdf")}>
          {busy === "pdf" ? "Đang gộp PDF chứng chỉ…" : <><FileText className="ico" size={16} aria-hidden="true" /> Tải hồ sơ PDF (.zip)</>}
        </button>
      </div>
    </div>
  );
}
