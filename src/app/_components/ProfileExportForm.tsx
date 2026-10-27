import { Download, FileText, GripVertical } from "lucide-react";
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
import { downloadBlob, downloadXlsx, exportProfileBundle, exportProfilePdf, exportProfileWorkbook, isConverterMissing, profileFileName, zipFiles } from "./profileExport";
import type { App, SetNotice } from "./shared";
import { certTone } from "./certTones";
import { moveId, useDragReorder } from "./useDragReorder";
import { applyFileNamePattern, FILE_NAME_TOKENS } from "../../modules/excel-template/fileNamePattern";
import { expirySortKey, formatExpiry, isValidOn } from "../../modules/certificates/status";

type ProfileTemplate = ExcelReportTemplate & { profile: ProfileTemplateConfig };

/** Xuất "Mẫu hồ sơ" cho một nhân sự: nhập trường tùy chỉnh, chọn chứng chỉ, xem cảnh báo. */
export function ProfileExportForm(props: { app: App; actor: Actor; template: ProfileTemplate; employee: Employee; certificates: readonly Certificate[]; sessionFiles: Readonly<Record<string, File>>; setNotice: SetNotice; loadSignatureFile?: SignatureFileLoader | undefined; pdfOnly?: boolean; onSaveFileNamePattern?: ((pattern: string) => void) | undefined }) {
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
  const [selected, setSelected] = useState<string[]>(() => current.filter((certificate) => isValidOn(certificate.expiryDate, exportDate) && profile.attachments.includes(certificate.type)).map((certificate) => certificate.id));
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  /** Quy tắc đặt tên tệp, nhớ theo mẫu (lưu vào mẫu khi xuất). */
  const [namePattern, setNamePattern] = useState(profile.fileNamePattern ?? "");
  const namePreview = namePattern.trim() ? applyFileNamePattern(namePattern, employee, exportDate) : null;
  const fileName = (extension: "xlsx" | "pdf" | "zip") => profileFileName(employee, exportDate, extension, namePattern);
  const insertToken = (token: string) => setNamePattern((current) => current.trim() ? `${current.trimEnd()} - ${token}` : token);

  useEffect(() => {
    let active = true;
    void app.certificateTypes.list(actor, true).then((types) => {
      if (!active) return;
      if (types.ok) setTypeNames(Object.fromEntries(types.value.map((type) => [type.key, type.name])));
    });
    return () => { active = false; };
  }, [app, actor]);

  const defaultOrder = useMemo(() => [...current].sort((a, b) => {
    const rank = (type: string) => { const index = profile.attachments.indexOf(type); return index < 0 ? 99 : index; };
    return rank(a.type) - rank(b.type) || expirySortKey(a.expiryDate).localeCompare(expirySortKey(b.expiryDate));
  }).map((certificate) => certificate.id), [current, profile.attachments]);
  /** Thứ tự ghép sau phiếu: mặc định theo loại trong mẫu, người xuất kéo thả hoặc chọn số để đổi. */
  const [chosenOrder, setChosenOrder] = useState<string[] | null>(null);
  const certificateOrder = chosenOrder ? [...chosenOrder.filter((id) => defaultOrder.includes(id)), ...defaultOrder.filter((id) => !chosenOrder.includes(id))] : defaultOrder;
  const { order, draggingId, handleProps } = useDragReorder(certificateOrder, setChosenOrder);
  const byId = new Map(current.map((certificate) => [certificate.id, certificate]));
  const ordered = order.flatMap((id) => byId.get(id) ?? []);

  const run = async (format: "xlsx" | "pdf") => {
    setBusy(format);
    // Admin đổi quy tắc đặt tên thì lưu vào mẫu, lần xuất sau (cả xuất hàng loạt) dùng lại; HR chỉ áp dụng cho lần xuất này
    if (actor.role === "admin" && namePattern.trim() !== (profile.fileNamePattern ?? "").trim()) props.onSaveFileNamePattern?.(namePattern.trim());
    try {
      // CCCD trong hồ sơ đang bị che; chỉ mở khi mẫu thật sự cần (có ghi nhật ký)
      let fullEmployee = employee;
      if (profile.placeholders.includes("cccd")) {
        const revealed = await app.employees.revealCccd(actor, employee.id);
        if (revealed.ok) fullEmployee = { ...employee, cccd: revealed.value };
      }
      const input = { template, employee: fullEmployee, commander, signer: needsSigner ? signer : null, certificates, certificateTypeNames: typeNames, sessionFiles: props.sessionFiles, selectedCertificateIds: selected, certificateOrder, overrides, exportDate };
      let label = format === "pdf" ? "PDF" : "Excel";
      let warningList: string[];
      if (format === "pdf") {
        // Một file PDF: phiếu (Excel → PDF trên máy chủ) rồi các chứng chỉ đã chọn ở dưới
        try {
          const result = await exportProfilePdf(input);
          downloadBlob(new Blob([result.bytes.slice().buffer], { type: "application/pdf" }), fileName("pdf"));
          warningList = result.warnings;
        } catch (error) {
          if (!isConverterMissing(error)) throw error;
          // Máy chủ chưa cài ComPDF / Gotenberg: vẫn tải được phiếu Excel + PDF gộp chứng chỉ
          const result = await exportProfileBundle(input);
          downloadBlob(await zipFiles(result.files), fileName("zip"));
          warningList = ["Máy chủ chưa cài máy chuyển PDF nên phiếu vẫn là file Excel (đã nén ZIP kèm PDF chứng chỉ)", ...result.warnings];
          label = "ZIP (Excel + PDF chứng chỉ)";
        }
      } else {
        const result = await exportProfileWorkbook(input);
        downloadXlsx(result.bytes, fileName("xlsx"));
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
        {ordered.length > 1 && <p className="muted">Kéo biểu tượng ⋮⋮ hoặc chọn số thứ tự để đổi thứ tự ghép sau phiếu.</p>}
        {ordered.length ? ordered.map((certificate, index) => {
          const hasBinary = Boolean(props.sessionFiles[certificate.document.id]);
          const expired = !isValidOn(certificate.expiryDate, exportDate);
          const name = `${typeNames[certificate.type] ?? certificate.type}${certificate.title ? ` (${certificate.title})` : ""}`;
          // Màu đi theo chứng chỉ (không theo vị trí) để khi kéo dễ nhìn ra dòng nào đang di chuyển
          const tone = certTone(defaultOrder.indexOf(certificate.id));
          return (
            <div className={certificate.id === draggingId ? "profile-export-cert-row dragging" : "profile-export-cert-row"} key={certificate.id} data-reorder-id={certificate.id} style={{ background: tone.background, borderLeftColor: tone.border }}>
              {ordered.length > 1 && (
                <button type="button" className="drag-handle" aria-label={`Kéo để đổi thứ tự ${name} (hoặc bấm ↑/↓)`} title="Kéo để đổi thứ tự" {...handleProps(certificate.id)}>
                  <GripVertical className="ico" size={16} aria-hidden="true" />
                </button>
              )}
              <label className="check-field profile-export-cert">
                <input type="checkbox" checked={selected.includes(certificate.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, certificate.id] : selected.filter((id) => id !== certificate.id))} />
                <span><b>{name}</b> · {certificate.number ? `Số ${certificate.number}` : "Không ghi số"} · {certificate.expiryDate ? `Hết hạn ${formatExpiry(certificate.expiryDate)}` : "Không thời hạn"}</span>
                {expired && <span className="pill bad">Đã hết hạn</span>}
                {!profile.attachments.includes(certificate.type) && <span className="pill">Ngoài danh sách của mẫu</span>}
                {!hasBinary && <span className="pill warn">Chưa có tệp trong phiên</span>}
              </label>
              {ordered.length > 1 && (
                <select className="cert-position" aria-label={`Thứ tự của ${name}`} title="Thứ tự ghép sau phiếu" value={index + 1} onChange={(event) => setChosenOrder(moveId(order, certificate.id, Number(event.target.value) - 1))}>
                  {ordered.map((_, position) => <option key={position} value={position + 1}>{position + 1}</option>)}
                </select>
              )}
            </div>
          );
        }) : <p className="muted">Nhân sự chưa có chứng chỉ hiện hành.</p>}
      </section>
      {warnings && warnings.length > 0 && (
        <div className="readiness-warnings">
          <b>Đã xuất, nhưng còn {warnings.length} mục để trống hoặc chưa đính kèm được:</b>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
      <section className="file-name-rule">
        <h3>Quy tắc đặt tên tệp</h3>
        <input type="text" value={namePattern} maxLength={150} placeholder="Vd: Vinci - {mã nhân viên} - {tên nhân viên}" aria-label="Quy tắc đặt tên tệp" onChange={(event) => setNamePattern(event.target.value)} />
        <div className="file-name-tokens">
          <span className="muted">Chèn:</span>
          {FILE_NAME_TOKENS.map((item) => <button type="button" className="pill" key={item.token} onClick={() => insertToken(item.token)}>{item.token}</button>)}
        </div>
        <p className="muted file-name-example">Ví dụ: <b>{fileName(props.pdfOnly ? "pdf" : "xlsx")}</b>{namePattern.trim() ? "" : " (để trống là tên mặc định)"}</p>
        {namePreview && namePreview.unknownTokens.length > 0 && <p className="form-error">Không nhận ra: {namePreview.unknownTokens.join(", ")}. Dùng các biến ở trên.</p>}
      </section>
      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        {!props.pdfOnly && <button type="button" className="button" disabled={busy !== null} onClick={() => void run("xlsx")}>
          {busy === "xlsx" ? "Đang tạo Excel…" : <><Download className="ico" size={16} aria-hidden="true" /> Tải Excel (.xlsx)</>}
        </button>}
        <button type="button" className="button primary" disabled={busy !== null} onClick={() => void run("pdf")}>
          {busy === "pdf" ? "Đang tạo PDF…" : <><FileText className="ico" size={16} aria-hidden="true" /> Tải hồ sơ PDF</>}
        </button>
      </div>
    </div>
  );
}
