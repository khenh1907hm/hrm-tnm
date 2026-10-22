import { useState } from "react";
import { Paperclip, Plus, Star } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import type { CertificateChecklistRow, CertificateChecklistSummary } from "../../modules/certificates/checklist";
import type { Certificate, FileRef } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Employee } from "../../modules/employees/types";
import type { App, SetNotice } from "./shared";

export function EmployeeDetailView(props: {
  app: App;
  actor: Actor;
  employee: Employee;
  checklistRows: CertificateChecklistRow[];
  checklistSummary: CertificateChecklistSummary;
  employeeCertificates: Certificate[];
  certificateTypes: CertificateTypeRecord[];
  setNotice: SetNotice;
  onBack: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onShowFile: (file: FileRef) => void;
  onCertificateForm: (type: string, certificate?: Certificate) => void;
  onRenewCertificate: (certificate: Certificate) => void;
  onArchiveCertificate: (certificate: Certificate) => void;
  onRestoreCertificate: (certificate: Certificate) => void;
}) {
  const { app, actor, employee: selected, checklistRows, checklistSummary, employeeCertificates, certificateTypes } = props;
  const [showCertificateHistory, setShowCertificateHistory] = useState(false);
  return <>
    <button className="back-button" onClick={props.onBack}>← Quay lại danh sách</button>
    <div className="page-head"><div><h1>{selected.name}</h1><p>{selected.code} · {selected.position} · {selected.archivedAt ? "Đã lưu trữ" : selected.status}</p></div><div className="button-row">{actor.role === "admin" && <>{selected.archivedAt ? <button className="button" onClick={props.onRestore}>Khôi phục</button> : <><button className="button" onClick={props.onEdit}>Sửa hồ sơ</button><button className="button danger" onClick={props.onArchive}>Lưu trữ</button></>}</>}{!selected.archivedAt && <><button className="button" onClick={props.onExportExcel}>Xuất hồ sơ theo mẫu</button><button className="button primary" onClick={props.onExportPdf}>Xuất hồ sơ PDF</button></>}</div></div>
    <section className="panel detail-panel">
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {selected.photo && (
          <div className="photo-preview-3x4" style={{ marginBottom: "10px" }}>
            <img src={selected.photo} alt={`Ảnh ${selected.name}`} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: "260px" }}>
          <h2>Thông tin cá nhân</h2>
          <dl>{[["Ngày sinh", selected.dob], ["Giới tính", selected.gender], ["CCCD", selected.cccd], ["Điện thoại", selected.phone], ["Nguyên quán", selected.home || "Chưa có"], ["Thường trú", selected.address || "Chưa có"], ["Địa chỉ hiện tại", selected.currentAddress || "Chưa có"], ["Ngày làm nghề", selected.startDate], ["Ngày vào TNM", selected.companyStartDate || "Chưa có"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <div className="employee-signature-detail"><span className="muted">Chữ ký</span>{selected.signatureImage ? <div className="employee-signature-preview"><img src={selected.signatureImage} alt={`Chữ ký ${selected.name}`} /></div> : "Chưa có"}</div>
          <button className="button" onClick={async () => { const result = await app.employees.revealCccd(actor, selected.id); if (result.ok) props.setNotice(`CCCD đầy đủ: ${result.value}`); }}>Hiện CCCD đầy đủ</button>
        </div>
      </div>
    </section>
    <section className="panel detail-panel">
      <div className="page-head">
        <div><h2>Chứng chỉ</h2><p>Thiếu {checklistSummary.missing}, sắp hết hạn {checklistSummary.expiring}, đã hết hạn {checklistSummary.expired}</p></div>
        <label className="check-field"><input type="checkbox" checked={showCertificateHistory} onChange={(event) => setShowCertificateHistory(event.target.checked)} /> Hiện chứng chỉ đã ẩn và đã thay thế</label>
      </div>
      <div className="table-scroll">
        <table className="certificate-table">
          <thead><tr><th>Loại chứng chỉ</th><th>Số chứng chỉ</th><th>Ngày hết hạn</th><th>Tình trạng</th><th>Tệp đính kèm</th>{actor.role === "admin" && <th><span className="sr-only">Thao tác</span></th>}</tr></thead>
          <tbody>{checklistRows.map((row) => {
            const certificate = employeeCertificates.find((item) => item.type === row.type && item.title === row.title && item.state === "current");
            return (
              <tr key={`${row.type}:${certificate?.id ?? "missing"}`} className={row.status === "missing" ? "certificate-missing" : undefined}>
                <td><b>{row.displayName}</b>{certificate?.safetyGroup && certificate.title !== `Nhóm ${certificate.safetyGroup}` ? <span className="pill info safety-pill">Nhóm {certificate.safetyGroup}</span> : null}</td>
                <td>{row.number ?? "—"}</td>
                <td>{row.expiryDate ? row.expiryDate.split("-").reverse().join("/") : "—"}</td>
                <td><span className={`pill ${row.status === "valid" ? "ok" : row.status === "expiring" ? "warn" : row.status === "expired" || row.status === "missing" ? "bad" : "none"}`}>{row.statusLabel}{row.status === "expiring" && row.daysLeft !== null ? ` (còn ${row.daysLeft} ngày)` : ""}</span></td>
                <td>{certificate ? (
                  <div className="file-chips">
                    <button type="button" className="file-chip is-primary" title={`Xem tệp chính: ${certificate.document.name}`} onClick={() => props.onShowFile(certificate.document)}><Star size={12} aria-hidden="true" /> Tệp chính</button>
                    {certificate.supplementaryFiles.map((item) => <button type="button" className="file-chip" key={item.file.id} title={`Xem ${item.file.name}`} onClick={() => props.onShowFile(item.file)}><Paperclip size={12} aria-hidden="true" /> {item.label ?? item.file.name}</button>)}
                  </div>
                ) : <span className="muted">—</span>}</td>
                {actor.role === "admin" && <td className="cert-actions">{certificate
                  ? <><button className="button" onClick={() => props.onCertificateForm(row.type, certificate)}>Sửa</button><button className="button" onClick={() => props.onRenewCertificate(certificate)}>Gia hạn</button><button className="button danger" onClick={() => props.onArchiveCertificate(certificate)}>Ẩn</button></>
                  : <button className="button primary" onClick={() => props.onCertificateForm(row.type)}><Plus className="ico" size={14} aria-hidden="true" /> Thêm</button>}</td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {actor.role === "admin" && (
        <div className="cert-add-more">
          <span className="muted">Thêm chứng chỉ khác cùng loại:</span>
          {certificateTypes.filter((type) => !type.archived).map((type) => <button className="button" key={type.id} onClick={() => props.onCertificateForm(type.key)}><Plus className="ico" size={14} aria-hidden="true" /> {type.key === "atld" ? "Nhóm ATLĐ khác" : type.name}</button>)}
        </div>
      )}
      {showCertificateHistory && employeeCertificates.filter((item) => item.state !== "current").map((certificate) => <div className="certificate-row" key={certificate.id}><b>{certificateTypes.find((type) => type.key === certificate.type)?.name ?? "Chứng chỉ"}{certificate.title ? ` (${certificate.title})` : ""}</b><span>{certificate.number} · {certificate.state === "replaced" ? "Đã thay thế" : "Đã ẩn"}</span>{actor.role === "admin" && certificate.state === "archived" && <button className="button" onClick={() => props.onRestoreCertificate(certificate)}>Khôi phục</button>}</div>)}
    </section>
  </>;
}
