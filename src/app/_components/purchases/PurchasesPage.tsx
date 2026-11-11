"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Settings2, ShoppingCart, Trash2 } from "lucide-react";
import { normalizeText } from "../../../lib/text";
import type { Actor } from "../../../modules/auth/permissions";
import { formatVnd } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Project } from "../../../modules/projects/types";
import type { PurchaseStore } from "../../../modules/purchases/store";
import { PURCHASE_KIND_LABELS, PURCHASE_STATUS_LABELS, type PurchaseApprover, type PurchaseKind, type PurchaseOrder, type PurchasePayment, type PurchaseRoles, type PurchaseStatus } from "../../../modules/purchases/types";
import type { Notify } from "../Toast";
import { EmployeePicker } from "../projects/ProjectsPage";
import { errorMessage, viewerFor, type EmployeeSource } from "../projects/projectShared";
import { PurchaseDetail } from "./PurchaseDetail";
import { FlowLegend, MiniProgress } from "./FlowBar";
import { PurchaseFormModal } from "./PurchaseFormModal";
import "../projects/projects.css";
import "./purchases.css";

type Tab = "todo" | "mine" | "all";
type Context = { roles: PurchaseRoles; userId: string; projects: Project[]; leadProjectIds: Set<string>; approvers: PurchaseApprover[] };

async function loadContext(store: PurchaseStore, projectStore: ProjectStore, actor: Actor): Promise<Context> {
  const [roles, userId, projects, approvers, me] = await Promise.all([store.myRoles(), store.myUserId(), projectStore.listProjects(), store.approvers(), projectStore.myEmployeeId()]);
  const leadProjectIds = new Set<string>();
  for (const project of projects) if (viewerFor(actor, me, project, await projectStore.listMembers(project.id)).isLead) leadProjectIds.add(project.id);
  return { roles, userId, projects, leadProjectIds, approvers };
}

/** Việc người này cần làm với đơn: sếp duyệt đơn / khoản chi, kế toán chi, người lập xử lý bước tiếp. */
function needsMe(order: PurchaseOrder, context: Context, pending: readonly PurchasePayment[]): boolean {
  const pays = pending.filter((payment) => payment.orderId === order.id);
  if (context.roles.isApprover && (order.status === "submitted" || pays.some((payment) => payment.status === "requested"))) return true;
  if (context.roles.isPayer && pays.some((payment) => payment.status === "approved")) return true;
  return order.requesterId === context.userId && ["draft", "rejected", "approved", "ordered", "received"].includes(order.status);
}

/** Danh sách đơn hàng (dùng ở trang Đặt hàng và tab Đặt hàng của dự án). */
export function PurchaseList(props: { orders: PurchaseOrder[]; projects: readonly Project[]; pending: readonly PurchasePayment[]; onOpen: (id: string) => void; hideProject?: boolean }) {
  if (!props.orders.length) return <p className="muted">Không có đơn hàng nào.</p>;
  return (
    <div className="table-scroll">
      <table className="pj-table">
        <thead><tr><th>Mã</th><th>Nội dung</th>{!props.hideProject && <th>Cho</th>}<th>Người lập</th><th className="pj-num">Tổng</th><th>Tiến độ</th></tr></thead>
        <tbody>{props.orders.map((order) => {
          const project = order.projectId ? props.projects.find((item) => item.id === order.projectId) : null;
          const pays = props.pending.filter((payment) => payment.orderId === order.id);
          return (
            <tr key={order.id} style={{ cursor: "pointer" }} onClick={() => props.onOpen(order.id)}>
              <td><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); props.onOpen(order.id); }}>{order.code}</button></td>
              <td>{order.title}<br /><small className="muted">{order.items.length} món{order.neededBy ? ` · cần trước ${order.neededBy.split("-").reverse().join("/")}` : ""}</small></td>
              {!props.hideProject && <td>{project ? `${project.code}` : PURCHASE_KIND_LABELS[order.kind]}{order.kind === "office" && order.department ? <><br /><small className="muted">{order.department}</small></> : null}</td>}
              <td>{order.requesterName}</td>
              <td className="pj-num">{formatVnd(order.totalActual ?? order.totalEstimate)}</td>
              <td><MiniProgress status={order.status} />
                {pays.some((payment) => payment.status === "requested") && <><br /><small className="warn-text">Có khoản chi chờ duyệt</small></>}
                {pays.some((payment) => payment.status === "approved") && <><br /><small className="warn-text">Có khoản chờ chi</small></>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

/** Trang Đặt hàng (/dat-hang): đơn mua cho dự án và văn phòng, phê duyệt bởi sếp (PUR-01..05). */
export function PurchasesPage(props: { store: PurchaseStore; projectStore: ProjectStore; ready: boolean; actor: Actor; employees: EmployeeSource; orderId: string | null; onOpen: (orderId: string | null) => void; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [context, setContext] = useState<Context | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [tab, setTab] = useState<Tab>("todo");
  const [kind, setKind] = useState<PurchaseKind | "*">("*");
  const [status, setStatus] = useState<PurchaseStatus | "*">("*");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);

  const fetchAll = useCallback(() => Promise.all([loadContext(store, props.projectStore, props.actor), store.listOrders(), store.listPendingPayments()]), [store, props.projectStore, props.actor]);
  const apply = useCallback(([nextContext, nextOrders, nextPending]: Awaited<ReturnType<typeof fetchAll>>) => { setContext(nextContext); setOrders(nextOrders); setPending(nextPending); }, []);
  const reload = useCallback(async () => { try { apply(await fetchAll()); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchAll, apply, setNotice]);
  useEffect(() => {
    if (!props.ready) return;
    let active = true;
    void fetchAll().then((result) => { if (active) apply(result); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setOrders([]); } });
    return () => { active = false; };
  }, [props.ready, fetchAll, apply, setNotice]);

  const shown = useMemo(() => {
    if (!orders || !context) return [];
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    return orders.filter((order) => (tab === "all" || (tab === "mine" ? order.requesterId === context.userId : needsMe(order, context, pending)))
      && (kind === "*" || order.kind === kind) && (status === "*" || order.status === status)
      && tokens.every((token) => normalizeText(`${order.code} ${order.title} ${order.supplier} ${order.requesterName}`).includes(token)));
  }, [orders, context, pending, tab, kind, status, query]);

  if (!orders || !context) return <div className="loading">Đang tải đơn hàng…</div>;
  if (props.orderId) return <PurchaseDetail key={props.orderId} store={store} orderId={props.orderId} projects={context.projects} roles={context.roles} userId={context.userId} isAdmin={props.actor.role === "admin"} leadProjectIds={context.leadProjectIds} onBack={() => props.onOpen(null)} onChanged={() => void reload()} setNotice={setNotice} />;

  const todoCount = orders.filter((order) => needsMe(order, context, pending)).length;
  const approverNames = context.approvers.map((item) => item.name).join(", ") || "chưa đặt";
  return (
    <section className="pj-page">
      <div className="page-head">
        <div><h1>Đặt hàng</h1><p>Mua hàng cho dự án và văn phòng. Người duyệt: <b>{approverNames}</b>.</p></div>
        <div className="button-row">
          {props.actor.role === "admin" && <button type="button" className="button" onClick={() => setSettings((value) => !value)}><Settings2 className="ico" size={16} aria-hidden="true" /> Người duyệt</button>}
          <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> Đơn hàng mới</button>
        </div>
      </div>
      <section className="panel pj-section" aria-label="Quy trình đặt hàng"><FlowLegend /></section>
      {context.approvers.some((item) => !item.hasAccount) && <p className="list-notice is-warn">{context.approvers.filter((item) => !item.hasAccount).map((item) => item.name).join(", ")} chưa có tài khoản liên kết hồ sơ nên chưa duyệt được. Admin vào Tài khoản & phân quyền để cấp và liên kết.</p>}
      {settings && <ApproverSettings store={store} approvers={context.approvers} employees={props.employees} onSaved={() => { setSettings(false); void reload(); }} setNotice={setNotice} />}
      <div className="pj-tabs" role="tablist" aria-label="Lọc đơn">
        <button type="button" role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>Cần tôi xử lý ({todoCount})</button>
        <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>Đơn của tôi</button>
        {context.roles.seesAll && <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>Tất cả</button>}
      </div>
      <div className="pj-toolbar">
        <label className="sr-only" htmlFor="po-search">Tìm đơn</label>
        <input id="po-search" type="search" placeholder="Tìm theo mã, nội dung, nhà cung cấp, người lập" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Mua cho" value={kind} onChange={(event) => setKind(event.target.value as PurchaseKind | "*")}><option value="*">Dự án và văn phòng</option>{(Object.keys(PURCHASE_KIND_LABELS) as PurchaseKind[]).map((key) => <option key={key} value={key}>{PURCHASE_KIND_LABELS[key]}</option>)}</select>
        <select aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value as PurchaseStatus | "*")}><option value="*">Mọi trạng thái</option>{(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[]).map((key) => <option key={key} value={key}>{PURCHASE_STATUS_LABELS[key]}</option>)}</select>
      </div>
      <section className="panel pj-section"><PurchaseList orders={shown} projects={context.projects} pending={pending} onOpen={(id) => props.onOpen(id)} /></section>
      {creating && <PurchaseFormModal store={store} projects={context.projects} initial={null} onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi sếp duyệt.` : `Đã lưu nháp ${order.code}.`, "success"); void reload(); props.onOpen(order.id); }} />}
    </section>
  );
}

function ApproverSettings(props: { store: PurchaseStore; approvers: PurchaseApprover[]; employees: EmployeeSource; onSaved: () => void; setNotice: Notify }) {
  const [list, setList] = useState(props.approvers);
  const [pickerKey, setPickerKey] = useState(0);
  const save = async () => {
    try { await props.store.setApprovers(list.map((item) => item.employeeId)); props.setNotice("Đã lưu người duyệt đơn hàng.", "success"); props.onSaved(); }
    catch (error) { props.setNotice(errorMessage(error), "error"); }
  };
  return (
    <section className="panel pj-section" aria-labelledby="po-approvers-title">
      <h2 id="po-approvers-title"><ShoppingCart className="ico" size={18} aria-hidden="true" /> Người phê duyệt đơn hàng</h2>
      <p className="muted">Chỉ những người này duyệt được đơn hàng và các khoản tạm ứng, thanh toán. Người duyệt phải có tài khoản đã liên kết với hồ sơ nhân sự.</p>
      <ul className="file-chips">{list.map((item) => <li key={item.employeeId} className="file-chip">{item.name}{!item.hasAccount && <small className="warn-text"> (chưa có tài khoản)</small>} <button type="button" className="link-button" aria-label={`Bỏ ${item.name}`} onClick={() => setList((current) => current.filter((entry) => entry.employeeId !== item.employeeId))}><Trash2 size={13} aria-hidden="true" /></button></li>)}</ul>
      <EmployeePicker key={pickerKey} label="Thêm người duyệt" source={props.employees} exclude={new Set(list.map((item) => item.employeeId))} onPick={(option) => { if (option) { setList((current) => [...current, { employeeId: option.id, name: option.name, hasAccount: true }]); setPickerKey((value) => value + 1); } }} />
      <div className="button-row"><button type="button" className="button primary" onClick={() => void save()}>Lưu người duyệt</button></div>
    </section>
  );
}
