import { useState } from "react";
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
    <div className="page-head"><div><h1>{selected.name}</h1><p>{selected.code} · {selected.position} · {selected.archivedAt ? "Đã lưu trữ" : selected.status}</p></div><div className="button-row">{actor.role === "admin" && <>{selected.archivedAt ? <button className="button" onClick={props.onRestore}>Khôi phục</button> : <><button className="button" onClick={props.onEdit}>Sửa hồ sơ</button><button className="button danger" onClick={props.onArchive}>Lưu trữ</button></>}</>}{!selected.archivedAt && <><button className="button" onClick={props.onExportExcel}>Xuất Excel theo mẫu</button><button className="button primary" onClick={props.onExportPdf}>Xuất hồ sơ PDF</button></>}</div></div>
    <section className="panel detail-panel">
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {selected.photo && (
          <div className="photo-preview-3x4" style={{ marginBottom: "10px" }}>
            <img src={selected.photo} alt={`Ảnh ${selected.name}`} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: "260px" }}>
          <h2>Thông tin cá nhân</h2>
          <dl>{[["Ngày sinh", selected.dob], ["Giới tính", selected.gender], ["CCCD", selected.cccd], ["Điện thoại", selected.phone], ["Nguyên quán", selected.home || "Chưa có"], ["Thường trú", selected.address || "Chưa có"], ["Địa chỉ hiện tại", selected.currentAddress || "Chưa có"], ["Ngày nhận việc", selected.startDate]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <button className="button" onClick={async () => { const result = await app.employees.revealCccd(actor, selected.id); if (result.ok) props.setNotice(`CCCD đầy đủ: ${result.value}`); }}>Hiện CCCD đầy đủ</button>
        </div>
      </div>
    </section>
    <section className="panel detail-panel"><div className="page-head"><div><h2>Chứng chỉ</h2><p>Thiếu {checklistSummary.missing}, sắp hết hạn {checklistSummary.expiring}, đã hết hạn {checklistSummary.expired}</p></div><label className="check-field"><input type="checkbox" checked={showCertificateHistory} onChange={(event) => setShowCertificateHistory(event.target.checked)} /> Hiện chứng chỉ đã ẩn và đã thay thế</label></div><div className="table-scroll"><table className="certificate-table"><thead><tr><th>Loại chứng chỉ</th><th>Số chứng chỉ</th><th>Ngày hết hạn</th><th>Tình trạng</th><th>Tệp chính</th><th>Tệp bổ sung</th><th>Thao tác</th></tr></thead><tbody>{checklistRows.map((row) => { const certificate = employeeCertificates.find((item) => item.type === row.type && item.title === row.title && item.state === "current"); return <tr key={`${row.type}:${certificate?.id ?? "missing"}`} className={row.status === "missing" ? "certificate-missing" : undefined}><td>{row.displayName}</td><td>{row.number ?? "—"}</td><td>{row.expiryDate ?? "—"}</td><td><span className={`pill ${row.status === "valid" ? "ok" : row.status === "expiring" ? "warn" : row.status === "expired" || row.status === "missing" ? "bad" : "none"}`}>{row.statusLabel}{row.status === "expiring" && row.daysLeft !== null ? ` (còn ${row.daysLeft} ngày)` : ""}</span></td><td>{certificate ? <button className="button" onClick={() => props.onShowFile(certificate.document)}>Xem {certificate.document.name}</button> : "—"}</td><td>{certificate ? <>{certificate.supplementaryFiles.length} tệp{certificate.supplementaryFiles.map((item) => <button className="button" key={item.file.id} onClick={() => props.onShowFile(item.file)}>Xem {item.label ?? item.file.name}</button>)}</> : "—"}</td><td>{actor.role === "admin" && (certificate ? <><button className="button" onClick={() => props.onCertificateForm(row.type, certificate)}>Sửa</button><button className="button" onClick={() => props.onRenewCertificate(certificate)}>Gia hạn</button><button className="button danger" onClick={() => props.onArchiveCertificate(certificate)}>Ẩn</button><button className="button" onClick={() => props.onCertificateForm(row.type, certificate)}>Thêm tệp bổ sung</button></> : <button className="button" onClick={() => props.onCertificateForm(row.type)}>Thêm chứng chỉ</button>)}</td></tr>; })}</tbody></table></div>{actor.role === "admin" && certificateTypes.filter((type) => !type.archived).map((type) => <button className="button" key={type.id} onClick={() => props.onCertificateForm(type.key)}>Thêm chứng chỉ khác cùng loại: {type.name}</button>)}{showCertificateHistory && employeeCertificates.filter((item) => item.state !== "current").map((certificate) => <div className="certificate-row" key={certificate.id}><b>{certificateTypes.find((type) => type.key === certificate.type)?.name ?? "Chứng chỉ"}</b><span>{certificate.number} · {certificate.state === "replaced" ? "Đã thay thế" : "Đã ẩn"}</span>{actor.role === "admin" && certificate.state === "archived" && <button className="button" onClick={() => props.onRestoreCertificate(certificate)}>Khôi phục</button>}</div>)}</section>
  </>;
}
