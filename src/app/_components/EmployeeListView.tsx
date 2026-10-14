import type { Actor } from "../../modules/auth/permissions";
import type { CertificateChecklistSummary } from "../../modules/certificates/checklist";
import type { Employee } from "../../modules/employees/types";

export type EmployeeFilters = { query: string; positionFilter: string; missingRequiredCertificate: boolean; includeArchived: boolean };

export function EmployeeListView(props: {
  actor: Actor;
  rows: Employee[];
  certificateHealth: Record<string, CertificateChecklistSummary>;
  alertCount: number;
  signatureCount: number;
  filters: EmployeeFilters;
  onFiltersChange: (filters: EmployeeFilters) => void;
  onCreate: () => void;
  onOpen: (employee: Employee) => void;
  onRestore: (employee: Employee) => void;
}) {
  const { actor, rows, certificateHealth, filters, onFiltersChange } = props;
  return <>
    <div className="page-head"><div><h1>Nhân sự</h1><p>Quản lý hồ sơ và tình trạng nhân sự</p></div>{actor.role === "admin" && <button className="button primary" onClick={props.onCreate}>＋ Thêm nhân sự</button>}</div>
    <div className="summary-row"><div><span>Tổng nhân sự</span><b>{rows.length}</b></div><div><span>Chứng chỉ cần chú ý</span><b>{props.alertCount}</b></div><div><span>Chữ ký</span><b>{props.signatureCount}</b></div></div>
    <div className="filter-row"><input aria-label="Tìm nhân sự" placeholder="Tìm theo tên, mã hoặc điện thoại" value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} /><select aria-label="Lọc chức danh" value={filters.positionFilter} onChange={(event) => onFiltersChange({ ...filters, positionFilter: event.target.value })}><option value="">Tất cả chức danh</option><option>Giám đốc</option><option>Nhân sự</option><option>Trưởng phòng kỹ thuật</option><option>Nhân viên kỹ thuật</option><option>Nhân viên hiện trường</option></select><label className="check-field"><input type="checkbox" checked={filters.missingRequiredCertificate} onChange={(event) => onFiltersChange({ ...filters, missingRequiredCertificate: event.target.checked })} /> Thiếu chứng chỉ bắt buộc</label>{actor.role === "admin" && <label className="check-field"><input type="checkbox" checked={filters.includeArchived} onChange={(event) => onFiltersChange({ ...filters, includeArchived: event.target.checked })} /> Hiện hồ sơ đã lưu trữ</label>}</div>
    <div className="panel table-scroll"><table><thead><tr><th>Mã nhân viên</th><th>Họ và tên</th><th>Điện thoại</th><th>Chức danh</th><th>Tình trạng chứng chỉ</th><th>Tình trạng nhân sự</th></tr></thead><tbody>{rows.map((employee) => { const health = certificateHealth[employee.id]; return <tr key={employee.id} onClick={() => props.onOpen(employee)}><td>{employee.code}</td><td><b>{employee.name}</b></td><td>{employee.phone}</td><td>{employee.position}</td><td>{health ? <span className={health.missing ? "pill bad" : health.expired ? "pill bad" : health.expiring ? "pill warn" : "pill ok"}>{health.missing ? `Thiếu ${health.missing} chứng chỉ bắt buộc` : health.expired ? `Đã hết hạn ${health.expired}` : health.expiring ? `Sắp hết hạn ${health.expiring}` : "Đầy đủ"}</span> : <span className="pill none">Đang kiểm tra</span>}</td><td><span className={employee.archivedAt ? "pill bad" : "pill ok"}>{employee.archivedAt ? "Đã lưu trữ" : employee.status === "active" ? "Đang làm việc" : employee.status}</span>{employee.archivedAt && actor.role === "admin" && <button className="button" onClick={(event) => { event.stopPropagation(); props.onRestore(employee); }}>Khôi phục</button>}</td></tr>; })}{!rows.length && <tr><td colSpan={6} className="empty">Không có nhân sự phù hợp.</td></tr>}</tbody></table></div>
  </>;
}
