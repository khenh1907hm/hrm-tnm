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
import { OrderMiniPath } from "./OrderProgress";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { MyApprovals } from "./ApprovalChain";
import { DEPARTMENTS, emptyDepartments, ROLE_LABELS, type Department, type DepartmentMembers } from "../../../modules/purchases/approval";
import { projectOrderPath, projectPath, routePath } from "../routes";
import "../projects/projects.css";
import "./purchases.css";
import { StageDepartmentsEditor } from "./StageDepartmentsEditor";
import { OfficeFundCard } from "./OfficeFund";
import { MaterialRequestsPanel, type MaterialScope } from "../projects/MaterialsTab";
import { systemClock, todayVN } from "../../../lib/clock";
import { SkeletonLines, SkeletonPage } from "../Skeleton";
import { mergeStageDepartments, type StageDepartments } from "../../../modules/purchases/flow";

type Tab = "todo" | "mine" | "all";
/** Giai đoạn giống tab Purchasing của dự án (dự án có thêm Material Request ở đầu, nằm trong từng dự án). */
type Stage = "*" | "materials" | "podraft" | "purchases" | "payments";
const DRAFT_STATUSES = new Set<PurchaseStatus>(["draft", "submitted", "rejected"]);
const inStage = (order: PurchaseOrder, stage: Stage, pending: readonly PurchasePayment[]) =>
  stage === "*" ? true
    : stage === "materials" ? false
    : stage === "podraft" ? DRAFT_STATUSES.has(order.status)
      : stage === "purchases" ? !DRAFT_STATUSES.has(order.status) && order.status !== "cancelled"
        : pending.some((payment) => payment.orderId === order.id) || order.status === "received";
/** Văn phòng có thêm YCVT ở đầu (như dự án), chung một quỹ năm không chia hạng mục. */
const OFFICE_MATERIAL_TAB = { key: "materials", label: "Yêu cầu vật tư", form: "P-COST-08" } as const;
const OFFICE_SCOPE: MaterialScope = { projectId: null, code: "VP", name: "Văn phòng", site: "" };
const stageFromUrl = (): Stage => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("muc") === "yeu-cau-vat-tu" ? "materials" : "*";
const STAGE_TABS: readonly { key: Exclude<Stage, "*">; label: string; form: string }[] = [
  { key: "podraft", label: "PO Draft", form: "P-CC-07" },
  { key: "purchases", label: "Purchase Order", form: "P-CC-08" },
  { key: "payments", label: "Request for Payment", form: "P-CF-03" },
];
type Context = { roles: PurchaseRoles; userId: string; projects: Project[]; leadProjectIds: Set<string>; approvers: PurchaseApprover[]; stageDepartments: StageDepartments };

async function loadContext(store: PurchaseStore, projectStore: ProjectStore, actor: Actor): Promise<Context> {
  const [roles, userId, projects, approvers, me, stageDepartments] = await Promise.all([store.myRoles(), store.myUserId(), projectStore.listProjects(), store.approvers(), projectStore.myEmployeeId(), store.stageDepartments().catch(() => mergeStageDepartments(null))]);
  // Một truy vấn lấy mọi vai trò của tôi trong các dự án (trước đây mỗi dự án một truy vấn, chạy nối tiếp → rất chậm khi nhiều dự án)
  const mine = me ? await projectStore.listMembershipsOf(me).catch(() => []) : [];
  const leadProjectIds = new Set(projects.filter((project) => viewerFor(actor, me, project, mine).isLead).map((project) => project.id));
  return { roles, userId, projects, leadProjectIds, approvers, stageDepartments };
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
              <td><OrderMiniPath order={order} payments={pays} />
                {pays.some((payment) => payment.status === "requested") && <><br /><small className="warn-text">Có khoản chi chờ duyệt</small></>}
                {pays.some((payment) => payment.status === "approved") && <><br /><small className="warn-text">Có khoản chờ chi</small></>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

/**
 * Trang đặt hàng theo phạm vi: Đặt hàng dự án (/dat-hang-du-an) hoặc Văn phòng (/dat-hang, chỉ đơn phục vụ văn phòng).
 * Danh sách đơn: người dùng thấy đơn của mình, quản lý thấy tất cả. Bảng tình trạng (dạng cột) nằm ở trang Việc của tôi.
 */
export function PurchasesPage(props: { /** "project": Đặt hàng dự án (mục Dự án); "office": Văn phòng (mục Mua hàng). */ scope: PurchaseKind; store: PurchaseStore; projectStore: ProjectStore; ready: boolean; actor: Actor; employees: EmployeeSource; orderId: string | null; onOpen: (orderId: string | null) => void; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [context, setContext] = useState<Context | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [tabChoice, setTab] = useState<Tab | null>(null);
  const kind = props.scope;
  const [status, setStatus] = useState<PurchaseStatus | "*">("*");
  const [stage, setStage] = useState<Stage>(stageFromUrl);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [deptSettings, setDeptSettings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchAll = useCallback(() => Promise.all([loadContext(store, props.projectStore, props.actor), store.listOrders(), store.listPendingPayments()]), [store, props.projectStore, props.actor]);
  const apply = useCallback(([nextContext, nextOrders, nextPending]: Awaited<ReturnType<typeof fetchAll>>) => { setContext(nextContext); setOrders(nextOrders); setPending(nextPending); }, []);
  const reload = useCallback(async () => { try { apply(await fetchAll()); setRefreshKey((value) => value + 1); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchAll, apply, setNotice]);
  const loadStages = useCallback(() => store.stageDepartments(), [store]);
  useEffect(() => {
    if (!props.ready) return;
    let active = true;
    void fetchAll().then((result) => { if (active) apply(result); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setOrders([]); } });
    return () => { active = false; };
  }, [props.ready, fetchAll, apply, setNotice]);

  const shown = useMemo(() => {
    if (!orders || !context) return [];
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
    const tab = tabChoice ?? (context.roles.seesAll ? "all" : "mine");
    return orders.filter((order) => (tab === "all" || (tab === "mine" ? order.requesterId === context.userId : needsMe(order, context, pending)))
      && order.kind === kind && (status === "*" || order.status === status) && inStage(order, stage, pending)
      && tokens.every((token) => normalizeText(`${order.code} ${order.title} ${order.supplier} ${order.requesterName}`).includes(token)));
  }, [orders, context, pending, tabChoice, kind, status, query, stage]);

  // Đơn dự án mở qua /dat-hang/<id> (thông báo, Việc của tôi): chuyển vào đúng dự án của đơn
  const projectOrder = props.orderId && orders ? orders.find((order) => order.id === props.orderId && order.kind === "project" && order.projectId) : undefined;
  useEffect(() => {
    if (projectOrder?.projectId) window.history.replaceState(null, "", projectOrderPath(projectOrder.projectId, projectOrder.id, ["draft", "submitted", "rejected"].includes(projectOrder.status) ? "don-nhap" : "dat-hang"));
  }, [projectOrder]);

  if (!orders || !context || projectOrder) return props.orderId ? <SkeletonPage kind="detail" label="Đang tải đơn hàng…" /> : <SkeletonPage label="Đang tải đơn hàng…" />;
  // Đơn dự án mở từ /dat-hang/<id>: quay lại trang Đặt hàng dự án
  const backFromDetail = () => {
    const opened = orders.find((order) => order.id === props.orderId);
    if (opened?.kind === "project" && props.scope !== "project") window.history.pushState(null, "", routePath("projectPurchases"));
    else props.onOpen(null);
  };
  if (props.orderId) return <PurchaseDetail key={props.orderId} store={store} orderId={props.orderId} projects={context.projects} roles={context.roles} userId={context.userId} isAdmin={props.actor.role === "admin"} leadProjectIds={context.leadProjectIds} onBack={backFromDetail} onChanged={() => void reload()} setNotice={setNotice} />;

  const tab = tabChoice ?? (context.roles.seesAll ? "all" : "mine");
  const todoCount = orders.filter((order) => order.kind === kind && needsMe(order, context, pending)).length;
  const isProject = props.scope === "project";
  const approverNames = context.approvers.map((item) => item.name).join(", ") || "chưa đặt";
  return (
    <section className="pj-page">
      <div className="page-head">
        <div>{isProject
          ? <><h1>Đặt hàng dự án</h1><p>Đơn mua vật tư, thiết bị cho các dự án, ký theo cây duyệt của từng dự án (PO Draft → Purchase Order → Request for Payment).</p></>
          : <><h1>Văn phòng</h1><p>Đơn mua phục vụ văn phòng. Người duyệt: <b>{approverNames}</b>.</p></>}</div>
        <div className="button-row">
          {isProject && props.actor.role === "admin" && <button type="button" className="button" onClick={() => setDeptSettings((value) => !value)}><Settings2 className="ico" size={16} aria-hidden="true" /> Phòng ban &amp; giai đoạn</button>}
          {!isProject && props.actor.role === "admin" && <button type="button" className="button" onClick={() => setSettings((value) => !value)}><Settings2 className="ico" size={16} aria-hidden="true" /> Người duyệt đơn văn phòng</button>}
          <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> Đơn hàng mới</button>
        </div>
      </div>
      {!isProject && context.approvers.some((item) => !item.hasAccount) && <p className="list-notice is-warn">{context.approvers.filter((item) => !item.hasAccount).map((item) => item.name).join(", ")} chưa có tài khoản liên kết hồ sơ nên chưa duyệt được. Admin vào Tài khoản & phân quyền để cấp và liên kết.</p>}
      {deptSettings && <DepartmentSettings store={store} employees={props.employees} onSaved={() => { setDeptSettings(false); void reload(); }} setNotice={setNotice} />}
      {deptSettings && <StageDepartmentsEditor canEdit load={loadStages} save={async (value) => { await store.setStageDepartments(value); void reload(); }} setNotice={setNotice} />}
      {!isProject && <OfficeFundCard store={store} orders={orders} year={Number(todayVN(systemClock).slice(0, 4))} isAdmin={props.actor.role === "admin"} setNotice={setNotice} />}
      <MyApprovals store={store} refreshKey={refreshKey} onOpenOrder={(id) => props.onOpen(id)} projectHref={(projectId) => projectPath(projectId)} />
      {settings && <ApproverSettings store={store} approvers={context.approvers} employees={props.employees} onSaved={() => { setSettings(false); void reload(); }} setNotice={setNotice} />}
      <nav aria-label="Giai đoạn mua hàng">
        <ol className="op-track op-nav">
          {(isProject ? STAGE_TABS : [OFFICE_MATERIAL_TAB, ...STAGE_TABS]).map((item, index) => {
            const mine = orders.filter((order) => order.kind === kind && inStage(order, item.key, pending));
            const open = item.key === "materials" ? 0 : mine.filter((order) => order.status !== "completed" && order.status !== "cancelled").length;
            const selected = stage === item.key;
            return (
              <li key={item.key} className={`op-step ${selected ? "is-current" : "is-todo"}`}>
                <button type="button" className="op-nav-btn" aria-current={selected ? "page" : undefined} onClick={() => setStage(selected ? "*" : item.key)} title={selected ? "Bấm lần nữa để xem tất cả" : undefined}>
                  <span className="op-num" aria-hidden="true">{index + 1}</span>
                  <span className="op-text"><span className="op-label">{item.label}</span><small className="op-dept">{item.form}{open ? ` · ${open} mở` : ""}</small></span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {stage === "materials" ? <MaterialRequestsPanel store={store} scope={OFFICE_SCOPE} myEmployeeId={null} isAdmin={props.actor.role === "admin"} isLead={false}
        canSeeMoney={context.roles.seesAll || context.roles.isApprover} orderHref={(id) => `${routePath("purchases")}/${encodeURIComponent(id)}`} setNotice={setNotice} /> : <>
      <div className="pj-section-head">
      <div className="pj-tabs" role="tablist" aria-label="Lọc đơn">
        <button type="button" role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>Cần tôi xử lý ({todoCount})</button>
        <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>Đơn của tôi</button>
        {context.roles.seesAll && <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>Tất cả</button>}
      </div>
      </div>
      <div className="pj-toolbar">
        <label className="sr-only" htmlFor="po-search">Tìm đơn</label>
        <input id="po-search" type="search" placeholder="Tìm theo mã, nội dung, nhà cung cấp, người lập" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value as PurchaseStatus | "*")}><option value="*">Mọi trạng thái</option>{(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[]).map((key) => <option key={key} value={key}>{PURCHASE_STATUS_LABELS[key]}</option>)}</select>
      </div>
      {/* Bảng tình trạng đơn hàng đã chuyển sang trang Việc của tôi */}
      <section className="panel pj-section"><PurchaseList orders={shown} projects={context.projects} pending={pending} onOpen={(id) => props.onOpen(id)} hideProject={!isProject} /></section>
      </>}
      {creating && <PurchaseFormModal store={store} projects={context.projects} initial={null} fixedKind={props.scope} onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi ${order.kind === "project" ? "ký duyệt" : "sếp duyệt"}.` : `Đã lưu nháp ${order.code}.`, "success"); void reload(); props.onOpen(order.id); }} />}
    </section>
  );
}

/** Người thuộc từng bộ phận ký duyệt (P. Kỹ thuật, P. Vật tư, Kế toán, Lãnh đạo, Hành chánh). Bộ phận để trống thì chuỗi ký bỏ qua bước đó. */
function DepartmentSettings(props: { store: PurchaseStore; employees: EmployeeSource; onSaved: () => void; setNotice: Notify }) {
  const [members, setMembers] = useState<DepartmentMembers | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pickerKey, setPickerKey] = useState(0);
  useEffect(() => {
    let active = true;
    void props.store.departments().then((list) => {
      if (!active) return;
      const next = emptyDepartments();
      for (const item of list) next[item.department].push(item.employeeId);
      setMembers(next);
      setNames(Object.fromEntries(list.map((item) => [item.employeeId, item.name])));
    }, () => { if (active) setMembers(emptyDepartments()); });
    return () => { active = false; };
  }, [props.store]);
  if (!members) return <SkeletonLines lines={4} label="Đang tải bộ phận…" />;
  const set = (department: Department, ids: string[]) => setMembers({ ...members, [department]: ids });
  const save = async () => {
    try { await props.store.setDepartments(members); props.setNotice("Đã lưu bộ phận ký duyệt.", "success"); props.onSaved(); }
    catch (error) { props.setNotice(errorMessage(error), "error"); }
  };
  return (
    <section className="panel pj-section" aria-labelledby="po-dept-title">
      <h2 id="po-dept-title"><Settings2 className="ico" size={18} aria-hidden="true" /> Bộ phận ký duyệt</h2>
      <p className="muted">Đơn hàng dự án ký lần lượt: Phụ trách (PM của dự án) → P. Kỹ thuật → P. Vật tư → Kế toán → Lãnh đạo; sau đó người lập phát hành PO, theo dõi đơn; Kho nhận hàng, nhập kho. Yêu cầu vật tư: Kho → P. Vật tư → P. Kỹ thuật → Lãnh đạo. Ngân sách: Phụ trách → P. Kỹ thuật → Lãnh đạo. Bộ phận chưa có ai thì bước đó được bỏ qua. Mỗi người cần tài khoản đã liên kết hồ sơ nhân sự.</p>
      <div className="dept-grid">
        {DEPARTMENTS.map((department) => (
          <div key={department} className="dept-card">
            <b>{ROLE_LABELS[department]}</b>
            <ul className="file-chips">{members[department].map((id) => <li key={id} className="file-chip">{names[id] ?? id} <button type="button" className="link-button" aria-label={`Bỏ ${names[id] ?? id}`} onClick={() => set(department, members[department].filter((item) => item !== id))}><Trash2 size={13} aria-hidden="true" /></button></li>)}</ul>
            {!members[department].length && <small className="muted">Chưa có ai (bỏ qua bước này)</small>}
            <EmployeePicker key={`${department}-${pickerKey}`} label="Thêm người" source={props.employees} exclude={new Set(members[department])} onPick={(option) => {
              if (!option) return;
              setNames((current) => ({ ...current, [option.id]: option.name }));
              set(department, [...members[department], option.id]);
              setPickerKey((value) => value + 1);
            }} />
          </div>
        ))}
      </div>
      <div className="button-row"><button type="button" className="button primary" onClick={() => void save()}>Lưu bộ phận</button></div>
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
