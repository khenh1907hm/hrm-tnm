import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import type { AuditPage } from "../../app-core/createHrApp";
import type { Actor } from "../../modules/auth/permissions";
import { AUDIT_ENTITY_LABELS, auditActionLabel, auditChanges, auditSubject } from "../../modules/audit/describe";
import type { AuditEvent } from "../../modules/audit/types";
import { pageNumbers } from "./EmployeeListView";
import { issueText, type App } from "./shared";

const PAGE_SIZE = 50;
const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Người thực hiện: "Bạn" nếu là chính mình, còn lại vai trò + đuôi mã tài khoản. */
function actorLabel(event: AuditEvent, me: Actor): string {
  if (event.actorId === me.id) return "Bạn";
  const role = event.role === "admin" ? "Admin" : event.role === "hr" ? "HR" : "Hệ thống";
  return `${role} · …${event.actorId.slice(-6)}`;
}

/** Hồ sơ nhân sự liên quan (để bấm mở): chính nhân sự, hoặc chủ của chứng chỉ. */
function relatedEmployeeId(event: AuditEvent): string | null {
  if (event.entityType === "employee") return event.entityId;
  const doc = (event.after ?? event.before) as { employeeId?: unknown } | null;
  return event.entityType === "certificate" && typeof doc?.employeeId === "string" ? doc.employeeId : null;
}

/** Nhật ký thay đổi (chỉ admin): đọc theo trang, lọc theo loại đối tượng, bấm một dòng để xem trường đã đổi. */
export function AuditLogView(props: { app: App; actor: Actor; onOpenEmployee: (employeeId: string) => void }) {
  const { app, actor } = props;
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ key: string; data: AuditPage | null; error: string | null } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const key = `${entityType}|${page}|${actor.id}`;

  useEffect(() => {
    let current = true;
    void app.audit.page(actor, { page, pageSize: PAGE_SIZE, ...(entityType ? { entityType } : {}) }).then((loaded) => {
      if (!current) return;
      setResult(loaded.ok ? { key, data: loaded.value, error: null } : { key, data: null, error: issueText(loaded.errors[0]?.code ?? "FORBIDDEN") });
    }).catch((error: unknown) => { if (current) setResult({ key, data: null, error: error instanceof Error ? error.message : "Không tải được nhật ký." }); });
    return () => { current = false; };
  }, [app, actor, page, entityType, key]);

  const loading = result?.key !== key;
  const data = result?.data ?? null;
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return <>
    <div className="page-head">
      <div><h1>Nhật ký thay đổi</h1><p>Mọi thao tác thêm, sửa, lưu trữ, xem CCCD đầy đủ… ai làm, lúc nào, đổi gì. Chỉ admin xem được.</p></div>
      <label className="audit-filter">Đối tượng
        <select value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); setExpanded(null); }}>
          <option value="">Tất cả</option>
          {Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <section className="panel">
      {result?.error && !loading && <p className="empty">{result.error}</p>}
      {!result?.error && <div className="table-scroll">
        <table className="audit-table" aria-busy={loading}>
          <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Đối tượng</th><th>Thay đổi</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={5} className="empty">Đang tải nhật ký…</td></tr>}
            {data && !data.items.length && <tr><td colSpan={5} className="empty"><History size={20} aria-hidden="true" /> Chưa có thao tác nào.</td></tr>}
            {data?.items.map((event) => {
              const changes = auditChanges(event);
              const employeeId = relatedEmployeeId(event);
              const open = expanded === event.id;
              return <Fragment key={event.id}>
                <tr className={open ? "is-open" : undefined} onClick={() => setExpanded(open ? null : event.id)} aria-expanded={changes.length ? open : undefined}>
                  <td className="nowrap">{TIME_FORMAT.format(new Date(event.at))}</td>
                  <td>{actorLabel(event, actor)}</td>
                  <td>{auditActionLabel(event.action)}</td>
                  <td>{employeeId
                    ? <a href={`/nhan-su/${encodeURIComponent(employeeId)}`} onClick={(click) => { click.stopPropagation(); if (click.button === 0 && !click.ctrlKey && !click.metaKey) { click.preventDefault(); props.onOpenEmployee(employeeId); } }}>{auditSubject(event)}</a>
                    : auditSubject(event)}<small className="muted audit-entity">{AUDIT_ENTITY_LABELS[event.entityType] ?? event.entityType}</small></td>
                  <td className="muted">{changes.length ? `${changes.length} trường${open ? " ▲" : " ▼"}` : "—"}</td>
                </tr>
                {open && changes.length > 0 && <tr className="audit-detail"><td colSpan={5}>
                  <table><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead>
                    <tbody>{changes.map((change) => <tr key={change.field}><td>{change.label}</td><td className="audit-before">{change.before}</td><td className="audit-after">{change.after}</td></tr>)}</tbody>
                  </table>
                </td></tr>}
              </Fragment>;
            })}
          </tbody>
        </table>
      </div>}
      {data && data.total > 0 && <nav className="pager" aria-label="Phân trang nhật ký">
        <span className="pager-info">Hiển thị <b>{from}–{to}</b> / <b>{data.total}</b></span>
        <div className="pager-pages">
          <button type="button" className="pager-btn" aria-label="Trang trước" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          {pageNumbers(data.page, data.pageCount).map((value, index) => value === "gap"
            ? <span key={`gap-${index}`} className="pager-gap">…</span>
            : <button type="button" key={value} className={`pager-btn${value === data.page ? " is-current" : ""}`} aria-current={value === data.page ? "page" : undefined} onClick={() => setPage(value)}>{value}</button>)}
          <button type="button" className="pager-btn" aria-label="Trang sau" disabled={data.page >= data.pageCount} onClick={() => setPage(data.page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </nav>}
    </section>
  </>;
}
