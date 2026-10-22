import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, FileUp, PenLine, Plus, Search, ShieldCheck, Users, X } from "lucide-react";
import type { CertificateHealth, EmployeeFacets, EmployeeListInput, EmployeeSort } from "../../app-core/createHrApp";
import type { Actor } from "../../modules/auth/permissions";
import type { CertificateChecklistSummary } from "../../modules/certificates/checklist";
import { POSITIONS, type Employee, type EmploymentStatus } from "../../modules/employees/types";
import { issueText } from "./shared";

export type EmployeeFilters = {
  query: string;
  positions: string[];
  statuses: EmploymentStatus[];
  certificateHealth: CertificateHealth[];
  certificateTypes: string[];
  certificateTypeMode: "any" | "all";
  includeArchived: boolean;
  sort: EmployeeSort;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
};
export const DEFAULT_EMPLOYEE_FILTERS: EmployeeFilters = { query: "", positions: [], statuses: [], certificateHealth: [], certificateTypes: [], certificateTypeMode: "all", includeArchived: false, sort: "code", sortDir: "asc", page: 1, pageSize: 20 };
export type EmployeePageInfo = { total: number; page: number; totalPages: number; facets: EmployeeFacets };
export const EMPTY_PAGE_INFO: EmployeePageInfo = { total: 0, page: 1, totalPages: 1, facets: { positions: {}, statuses: {}, certificateHealth: { ok: 0, missing: 0, expiring: 0, expired: 0 }, certificateTypes: {} } };

export const STATUS_LABELS: Record<EmploymentStatus, string> = { active: "Đang làm việc", on_leave: "Tạm nghỉ", resigned: "Đã nghỉ việc" };
const HEALTH_OPTIONS: { value: CertificateHealth; label: string; tone: "ok" | "warn" | "bad" }[] = [
  { value: "ok", label: "Đầy đủ, còn hạn", tone: "ok" },
  { value: "missing", label: "Thiếu chứng chỉ bắt buộc", tone: "bad" },
  { value: "expiring", label: "Sắp hết hạn (30 ngày)", tone: "warn" },
  { value: "expired", label: "Đã hết hạn", tone: "bad" },
];
const PAGE_SIZES = [10, 20, 50, 100];

/** Đổi bộ lọc trên màn hình thành tham số truy vấn danh sách nhân sự (có phân trang). */
export function toListInput(filters: EmployeeFilters): EmployeeListInput {
  return {
    query: filters.query, includeArchived: filters.includeArchived, page: filters.page, pageSize: filters.pageSize, sort: filters.sort, sortDir: filters.sortDir,
    positions: filters.positions, statuses: filters.statuses, certificateHealth: filters.certificateHealth, certificateTypes: filters.certificateTypes, certificateTypeMode: filters.certificateTypeMode,
  };
}

/** Dãy số trang gọn: 1 … 4 5 6 … 12 */
export function pageNumbers(page: number, pageCount: number): (number | "gap")[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((value, index) => index > 0 && value - sorted[index - 1]! > 1 ? ["gap" as const, value] : [value]);
}


type Option<T extends string> = { value: T; label: string; count: number; tone?: "ok" | "warn" | "bad" | "info" };

/** Nút lọc dạng menu thả xuống: bấm để mở danh sách ô tick, đếm số mục đang chọn. */
function FilterDropdown<T extends string>(props: { label: string; options: readonly Option<T>[]; selected: readonly T[]; onToggle: (value: T) => void; onClear: () => void; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const count = props.selected.length;
  const summary = count === 1 ? props.options.find((option) => option.value === props.selected[0])?.label : null;
  return (
    <div className="filter-dd" ref={rootRef}>
      <button type="button" className={`filter-dd-btn${count ? " is-active" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <span className="filter-dd-label">{props.label}{summary ? <>: <b>{summary}</b></> : null}</span>
        {count > 1 && <span className="filter-dd-count">{count}</span>}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-dd-menu" role="group" aria-label={props.label}>
          {props.extra}
          {props.options.map((option) => {
            const checked = props.selected.includes(option.value);
            return (
              <label key={option.value} className={`filter-dd-item${checked ? " is-on" : ""}${option.tone ? ` tone-${option.tone}` : ""}`}>
                <input type="checkbox" checked={checked} onChange={() => props.onToggle(option.value)} />
                <span className="chip-box" aria-hidden="true">{checked && <Check size={12} strokeWidth={3} />}</span>
                <span className="filter-dd-text">{option.label}</span>
                <span className="filter-dd-num">{option.count}</span>
              </label>
            );
          })}
          <div className="filter-dd-foot">
            <button type="button" className="link-button" disabled={!count} onClick={props.onClear}>Bỏ chọn</button>
            <button type="button" className="button primary" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EmployeeListView(props: {
  actor: Actor;
  rows: Employee[];
  pageInfo: EmployeePageInfo;
  loading: boolean;
  /** Lần tải danh sách gần nhất bị lỗi (mạng); dữ liệu đang hiện, nếu có, vẫn giữ nguyên. */
  error: boolean;
  onRetry: () => void;
  /** Dữ liệu có thể chưa mới nhất (tải ngầm lỗi). */
  stale: boolean;
  certificateHealth: Record<string, CertificateChecklistSummary>;
  alertCount: number;
  signatureCount: number;
  filters: EmployeeFilters;
  onFiltersChange: (filters: EmployeeFilters) => void;
  certificateTypes: readonly { key: string; name: string }[];
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onSelectAllMatching: () => void;
  onExportRoster: () => void;
  rosterBusy: boolean;
  onExportSelected: () => void;
  onCreate: () => void;
  onImport: () => void;
  onOpen: (employee: Employee) => void;
  onRestore: (employee: Employee) => void;
}) {
  const { actor, rows, pageInfo, certificateHealth, filters, selectedIds, onSelectedIdsChange } = props;
  const { facets } = pageInfo;
  /** Đổi bộ lọc → quay về trang 1 (trừ khi đang đổi trang). */
  const update = (patch: Partial<EmployeeFilters>) => props.onFiltersChange({ ...filters, ...patch, page: patch.page ?? 1 });

  // Ô tìm kiếm: hiện chữ ngay, nhưng chỉ lọc khi ngừng gõ 250 ms
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [syncedQuery, setSyncedQuery] = useState(filters.query);
  if (filters.query !== syncedQuery) { setSyncedQuery(filters.query); setQueryDraft(filters.query); }
  const { onFiltersChange } = props;
  useEffect(() => {
    if (queryDraft === filters.query) return;
    const timer = setTimeout(() => onFiltersChange({ ...filters, query: queryDraft, page: 1 }), 250);
    return () => clearTimeout(timer);
  }, [queryDraft, filters, onFiltersChange]);
  const toggleIn = <K extends "positions" | "statuses" | "certificateHealth" | "certificateTypes">(key: K, value: EmployeeFilters[K][number]) => {
    const list = filters[key] as string[];
    update({ [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] } as Partial<EmployeeFilters>);
  };

  const visibleIds = rows.filter((employee) => !employee.archivedAt).map((employee) => employee.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.includes(id));
  const toggle = (id: string, checked: boolean) => onSelectedIdsChange(checked ? [...selectedIds, id] : selectedIds.filter((item) => item !== id));
  const toggleAll = (checked: boolean) => onSelectedIdsChange(checked ? Array.from(new Set([...selectedIds, ...visibleIds])) : selectedIds.filter((id) => !visibleIds.includes(id)));

  const typeName = (key: string) => props.certificateTypes.find((type) => type.key === key)?.name ?? key;
  const activeChips = [
    ...filters.positions.map((value) => ({ key: `p:${value}`, label: value, remove: () => toggleIn("positions", value) })),
    ...filters.statuses.map((value) => ({ key: `s:${value}`, label: STATUS_LABELS[value], remove: () => toggleIn("statuses", value) })),
    ...filters.certificateHealth.map((value) => ({ key: `h:${value}`, label: HEALTH_OPTIONS.find((item) => item.value === value)!.label, remove: () => toggleIn("certificateHealth", value) })),
    ...filters.certificateTypes.map((value) => ({ key: `t:${value}`, label: `Có ${typeName(value)}`, remove: () => toggleIn("certificateTypes", value) })),
    ...(filters.includeArchived ? [{ key: "archived", label: "Gồm hồ sơ đã lưu trữ", remove: () => update({ includeArchived: false }) }] : []),
  ];
  const filtered = Boolean(filters.query) || activeChips.length > 0;
  const clearAll = () => update({ query: "", positions: [], statuses: [], certificateHealth: [], certificateTypes: [], certificateTypeMode: "all", includeArchived: false });

  const from = pageInfo.total ? (pageInfo.page - 1) * filters.pageSize + 1 : 0;
  const to = Math.min(pageInfo.total, pageInfo.page * filters.pageSize);
  const sortHeader = (key: EmployeeSort, label: string) => {
    const active = filters.sort === key;
    const Icon = active && filters.sortDir === "desc" ? ArrowUpAZ : ArrowDownAZ;
    return (
      <th aria-sort={active ? (filters.sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className={`sort-button${active ? " is-active" : ""}`} onClick={() => update({ sort: key, sortDir: active && filters.sortDir === "asc" ? "desc" : "asc" })}>
          {label} <Icon size={14} aria-hidden="true" />
        </button>
      </th>
    );
  };

  return <>
    <div className="page-head">
      <div><h1>Nhân sự</h1><p>Quản lý hồ sơ và tình trạng nhân sự</p></div>
      {actor.role === "admin" && <div className="button-row">
        <button className="button" onClick={props.onImport}><FileUp className="ico" size={16} aria-hidden="true" /> Nhập từ Excel</button>
        <button className="button primary" onClick={props.onCreate}><Plus className="ico" size={16} aria-hidden="true" /> Thêm nhân sự</button>
      </div>}
    </div>

    <div className="stat-strip">
      <div className="stat-chip tone-brand"><Users size={16} aria-hidden="true" /><span>{filtered ? "Kết quả lọc" : "Tổng nhân sự"}</span><b>{pageInfo.total}</b></div>
      <div className="stat-chip tone-ok"><ShieldCheck size={16} aria-hidden="true" /><span>Đủ chứng chỉ</span><b>{facets.certificateHealth.ok}</b></div>
      <div className="stat-chip tone-warn"><AlertTriangle size={16} aria-hidden="true" /><span>Chứng chỉ cần chú ý</span><b>{props.alertCount}</b></div>
      <div className="stat-chip tone-violet"><PenLine size={16} aria-hidden="true" /><span>Chữ ký</span><b>{props.signatureCount}</b></div>
    </div>

    <section className="panel list-card">
      <div className="list-toolbar">
        <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Tìm nhân sự" placeholder="Tìm tên, mã, điện thoại, CCCD" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} />{queryDraft && <button type="button" className="search-clear" aria-label="Xóa từ khóa" onClick={() => { setQueryDraft(""); update({ query: "" }); }}><X size={14} aria-hidden="true" /></button>}</label>
        <FilterDropdown label="Chức danh" selected={filters.positions} onToggle={(value) => toggleIn("positions", value)} onClear={() => update({ positions: [] })}
          options={POSITIONS.map((position) => ({ value: position, label: position, count: facets.positions[position] ?? 0 }))} />
        <FilterDropdown label="Tình trạng" selected={filters.statuses} onToggle={(value) => toggleIn("statuses", value)} onClear={() => update({ statuses: [] })}
          options={(Object.keys(STATUS_LABELS) as EmploymentStatus[]).map((status) => ({ value: status, label: STATUS_LABELS[status], count: facets.statuses[status] ?? 0 }))} />
        <FilterDropdown label="Chứng chỉ" selected={filters.certificateHealth} onToggle={(value) => toggleIn("certificateHealth", value)} onClear={() => update({ certificateHealth: [] })}
          options={HEALTH_OPTIONS.map((option) => ({ value: option.value, label: option.label, tone: option.tone, count: facets.certificateHealth[option.value] }))} />
        <FilterDropdown label="Loại chứng chỉ" selected={filters.certificateTypes} onToggle={(value) => toggleIn("certificateTypes", value)} onClear={() => update({ certificateTypes: [] })}
          options={props.certificateTypes.map((type) => ({ value: type.key, label: type.name, tone: "info" as const, count: facets.certificateTypes[type.key] ?? 0 }))}
          extra={<div className="filter-dd-mode"><span>Nhân sự có</span><span className="mode-switch" role="group" aria-label="Cách khớp loại chứng chỉ">
            <button type="button" aria-pressed={filters.certificateTypeMode === "all"} onClick={() => update({ certificateTypeMode: "all" })}>tất cả</button>
            <button type="button" aria-pressed={filters.certificateTypeMode === "any"} onClick={() => update({ certificateTypeMode: "any" })}>một trong</button>
          </span><span>loại đã chọn (còn hạn)</span></div>} />
        {actor.role === "admin" && <label className="toolbar-check"><input type="checkbox" checked={filters.includeArchived} onChange={(event) => update({ includeArchived: event.target.checked })} /> Đã lưu trữ</label>}
        {filtered && <button type="button" className="link-button toolbar-clear" onClick={clearAll}>Xóa lọc</button>}
      </div>
      {activeChips.length > 0 && (
        <div className="active-filters">
          {activeChips.map((chip) => <span className="filter-tag" key={chip.key}>{chip.label} <button type="button" aria-label={`Bỏ lọc ${chip.label}`} onClick={chip.remove}><X size={12} aria-hidden="true" /></button></span>)}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="selection-strip" role="region" aria-label="Nhân sự đã chọn">
          <span className="selection-count"><b>{selectedIds.length}</b> đã chọn</span>
          {allVisibleSelected && pageInfo.total > selectedIds.length && <button type="button" className="link-button" onClick={props.onSelectAllMatching}>Chọn tất cả {pageInfo.total} kết quả</button>}
          <span className="selection-actions">
            <button type="button" className="button success" disabled={props.rosterBusy} onClick={props.onExportRoster}><FileSpreadsheet className="ico" size={16} aria-hidden="true" /> {props.rosterBusy ? "Đang tạo Excel…" : "Xuất Excel thông tin"}</button>
            <button type="button" className="button" onClick={props.onExportSelected}><FileDown className="ico" size={16} aria-hidden="true" /> Xuất hồ sơ theo mẫu</button>
            <button type="button" className="button ghost" onClick={() => onSelectedIdsChange([])}>Bỏ chọn</button>
          </span>
        </div>
      )}

      {props.stale && <div className="list-notice is-warn" role="status"><AlertTriangle size={16} aria-hidden="true" />{issueText("DATA_STALE")}</div>}
      {props.error && rows.length > 0 && <div className="list-notice is-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{issueText("LIST_LOAD_FAILED")}<button type="button" className="button" onClick={props.onRetry}>Thử lại</button></div>}
      <div className={`table-scroll employee-table${props.loading && rows.length ? " is-loading" : ""}`}>
        <table><thead><tr>
          <th className="select-col"><input type="checkbox" aria-label="Chọn tất cả nhân sự trong trang" checked={allVisibleSelected} ref={(element) => { if (element) element.indeterminate = !allVisibleSelected && someVisibleSelected; }} onChange={(event) => toggleAll(event.target.checked)} /></th>
          {sortHeader("code", "Mã NV")}{sortHeader("name", "Họ và tên")}<th>Điện thoại</th><th>Chức danh</th>{sortHeader("startDate", "Ngày làm nghề")}<th>Tình trạng chứng chỉ</th><th>Tình trạng</th>
        </tr></thead><tbody>{rows.map((employee) => {
          const health = certificateHealth[employee.id];
          const checked = selectedIds.includes(employee.id);
          return <tr key={employee.id} className={checked ? "row-selected" : undefined} onClick={() => props.onOpen(employee)}>
            <td className="select-col" onClick={(event) => event.stopPropagation()}>{!employee.archivedAt && <input type="checkbox" aria-label={`Chọn ${employee.name}`} checked={checked} onChange={(event) => toggle(employee.id, event.target.checked)} />}</td>
            <td><span className="code-tag">{employee.code}</span></td>
            {/* Danh sách chỉ hiện họ tên (không ảnh, không chữ viết tắt) cho nhẹ; ảnh xem ở trang chi tiết */}
            <td><b>{employee.name}</b></td>
            <td>{employee.phone}</td><td>{employee.position}</td><td>{employee.startDate.split("-").reverse().join("/")}</td>
            <td>{health ? <span className={health.missing || health.expired ? "pill bad" : health.expiring ? "pill warn" : "pill ok"}>{health.missing ? `Thiếu ${health.missing} bắt buộc` : health.expired ? `Hết hạn ${health.expired}` : health.expiring ? `Sắp hết hạn ${health.expiring}` : "Đầy đủ"}</span> : <span className="pill none">Đang kiểm tra</span>}</td>
            <td><span className={employee.archivedAt ? "pill bad" : employee.status === "active" ? "pill ok" : "pill warn"}>{employee.archivedAt ? "Đã lưu trữ" : STATUS_LABELS[employee.status]}</span>{employee.archivedAt && actor.role === "admin" && <button className="button" onClick={(event) => { event.stopPropagation(); props.onRestore(employee); }}>Khôi phục</button>}</td>
          </tr>;
        })}{!rows.length && (props.error
          ? <tr><td colSpan={8} className="empty" role="alert">{issueText("LIST_LOAD_FAILED")} <button type="button" className="button" onClick={props.onRetry}>Thử lại</button></td></tr>
          : props.loading
            // Tải lần đầu: khung xương giữ chỗ, không nhảy bố cục
            ? Array.from({ length: 6 }, (_, index) => <tr key={`skeleton-${index}`} className="skeleton-row" aria-hidden="true">{Array.from({ length: 8 }, (_, cell) => <td key={cell}><span className="skeleton-bar" /></td>)}</tr>)
            : <tr><td colSpan={8} className="empty">{filtered ? <>Không có nhân sự phù hợp với bộ lọc. <button type="button" className="button" onClick={clearAll}>Xóa bộ lọc</button></> : "Chưa có nhân sự."}</td></tr>)}</tbody></table>
      {!rows.length && props.loading && !props.error && <p className="sr-only" role="status">Đang tải…</p>}
      </div>

      <nav className="pager" aria-label="Phân trang">
        <span className="pager-info">Hiển thị <b>{from}–{to}</b> / <b>{pageInfo.total}</b></span>
        <label className="pager-size">Mỗi trang
          <select value={filters.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select>
        </label>
        <div className="pager-pages">
          <button type="button" className="pager-btn" aria-label="Trang trước" disabled={pageInfo.page <= 1} onClick={() => update({ page: pageInfo.page - 1 })}><ChevronLeft size={16} aria-hidden="true" /></button>
          {pageNumbers(pageInfo.page, pageInfo.totalPages).map((value, index) => value === "gap"
            ? <span key={`gap-${index}`} className="pager-gap">…</span>
            : <button type="button" key={value} className={`pager-btn${value === pageInfo.page ? " is-current" : ""}`} aria-current={value === pageInfo.page ? "page" : undefined} onClick={() => update({ page: value })}>{value}</button>)}
          <button type="button" className="pager-btn" aria-label="Trang sau" disabled={pageInfo.page >= pageInfo.totalPages} onClick={() => update({ page: pageInfo.page + 1 })}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </nav>
    </section>
  </>;
}
