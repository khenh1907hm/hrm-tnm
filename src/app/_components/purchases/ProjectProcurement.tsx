"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardList, Plus, Receipt, ShoppingCart } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { FLOW_GROUPS, orderGroup, type FlowGroup, type PathKey } from "../../../modules/purchases/flow";
import type { MaterialRequest } from "../../../modules/purchases/materials";
import { PAYMENT_KIND_LABELS, PURCHASE_PAYMENT_STATUS_LABELS, type PaymentKind, type PurchaseOrder, type PurchasePayment } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { MaterialsTab } from "../projects/MaterialsTab";
import { errorMessage } from "../projects/projectShared";
import { SkeletonTable } from "../Skeleton";
import { ProjectOrderDetail, useProjectOrder } from "./ProjectOrderDetail";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { PurchaseList } from "./PurchasesPage";
import { getPurchaseStore } from "./usePurchaseStore";
import "./purchases.css";

/** Mục cũ (?muc=…) của tab Purchasing, giữ để link cũ và khung Người duyệt đúng loại phiếu. */
export type ProcurementStage = "materials" | "podraft" | "purchases" | "payments";
type View = "materials" | "orders" | "payments";
const viewOf = (stage: ProcurementStage): View => stage === "materials" ? "materials" : stage === "payments" ? "payments" : "orders";
const ORDER_GROUPS = FLOW_GROUPS.filter((group) => group.key !== "material");
const OPEN_MATERIAL = new Set<MaterialRequest["status"]>(["draft", "submitted", "approved", "rejected"]);
const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
const PAY_TONE: Record<PurchasePayment["status"], string> = { requested: "warn", approved: "warn", paid: "ok", rejected: "bad" };
/** Bước trên thanh của đơn ứng với một đề nghị: đã duyệt / đã chi thì mở bước "Chi …", còn lại mở bước "Đề nghị …". */
const PAY_STEP: Record<PaymentKind, [PathKey, PathKey]> = { advance: ["advance", "advance_pay"], prepayment: ["prepayment", "prepayment_pay"], final: ["final", "final_pay"] };

/**
 * Tab Purchasing của dự án, chia 3 danh sách để dễ kiểm soát:
 * Yêu cầu vật tư (mỗi phiếu nhiều hạng mục, nhiều báo giá, lên một hoặc nhiều đơn) · Đơn hàng (lọc theo bước) · Đề nghị thanh toán.
 * Bấm một dòng mới mở trang chi tiết kèm thanh tiến độ của phiếu / đơn đó.
 */
export function ProjectProcurement(props: TabProps & { stage: ProcurementStage; onStage: (stage: ProcurementStage) => void }) {
  const { store, data, setNotice } = props;
  const purchases = getPurchaseStore(store.mode);
  const { orderId, open, close } = useProjectOrder(data.project.id, "dat-hang");
  const view = viewOf(props.stage);
  const [group, setGroup] = useState<FlowGroup | "all">(props.stage === "podraft" ? "draft" : "all");
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<{ order: PurchaseOrder; payments: PurchasePayment[]; group: FlowGroup }[] | null>(null);
  const [materials, setMaterials] = useState<MaterialRequest[]>([]);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [creating, setCreating] = useState(false);
  const [payFilter, setPayFilter] = useState<"open" | "all">("open");
  const track = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [all, requests, pays] = await Promise.all([purchases.listOrders(), purchases.listMaterialRequests(data.project.id).catch(() => [] as MaterialRequest[]), purchases.listPendingPayments().catch(() => [] as PurchasePayment[])]);
      const orders = all.filter((order) => order.projectId === data.project.id);
      const withPays = await Promise.all(orders.map(async (order) => {
        const list = await purchases.listPayments(order.id).catch(() => [] as PurchasePayment[]);
        return { order, payments: list, group: orderGroup(order, list) };
      }));
      return { withPays, requests, pays };
    })().then(({ withPays, requests, pays }) => { if (active) { setRows(withPays); setMaterials(requests); setPending(pays); } },
      (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setRows([]); } });
    return () => { active = false; };
  }, [purchases, data.project.id, setNotice, refresh]);

  // Màn hẹp: cuộn để khối đang chọn nằm trong tầm nhìn
  useEffect(() => {
    const list = track.current;
    const node = list?.querySelector<HTMLElement>(".is-current");
    if (!list || !node) return;
    list.scrollLeft = Math.max(0, node.offsetLeft - list.clientWidth / 2 + node.clientWidth / 2);
  }, [group, orderId, view]);

  if (orderId) return <ProjectOrderDetail {...props} orderId={orderId} onBack={() => { close(); setRefresh((value) => value + 1); }} onChanged={() => setRefresh((value) => value + 1)} />;

  const all = rows ?? [];
  const activeOrders = all.filter((row) => row.group !== "completed").length;
  const payRows = all.flatMap((row) => row.payments.map((payment) => ({ payment, order: row.order })))
    .sort((a, b) => b.payment.requestedAt.localeCompare(a.payment.requestedAt));
  const openPays = payRows.filter((row) => row.payment.status === "requested" || row.payment.status === "approved");
  const tabs: readonly { key: View; label: string; count: number; icon: ReactNode; stage: ProcurementStage }[] = [
    { key: "materials", label: "Yêu cầu vật tư", count: materials.filter((request) => OPEN_MATERIAL.has(request.status)).length, icon: <ClipboardList size={16} aria-hidden="true" />, stage: "materials" },
    { key: "orders", label: "Đơn hàng", count: activeOrders, icon: <ShoppingCart size={16} aria-hidden="true" />, stage: "purchases" },
    { key: "payments", label: "Đề nghị thanh toán", count: openPays.length, icon: <Receipt size={16} aria-hidden="true" />, stage: "payments" },
  ];

  return (
    <>
      <div className="pc-tabs" role="tablist" aria-label="Danh sách mua hàng">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={view === tab.key} className={view === tab.key ? "is-on" : undefined} onClick={() => props.onStage(tab.stage)}>
            {tab.icon}<span>{tab.label}</span>{rows && tab.count > 0 && <b className="pc-count" title="Đang mở">{tab.count}</b>}
          </button>
        ))}
      </div>

      {view === "materials" && <MaterialsTab {...props} />}

      {view === "orders" && (
        <section className="panel pj-section" aria-labelledby="pj-flow-title">
          <div className="pj-section-head">
            <h2 id="pj-flow-title">Đơn hàng{group !== "all" ? ` · ${ORDER_GROUPS.find((item) => item.key === group)?.label}` : ""}</h2>
            <div className="button-row">
              {group !== "all" && <button type="button" className="button" onClick={() => setGroup("all")}>Xem tất cả</button>}
              <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> New PO Draft</button>
            </div>
          </div>
          <nav aria-label="Lọc đơn theo bước">
            <ol className="op-track op-nav op-flow" ref={track}>
              {ORDER_GROUPS.map((item, index) => {
                const selected = item.key === group;
                const n = all.filter((row) => row.group === item.key).length;
                return (
                  <li key={item.key} className={`op-step ${selected ? "is-current" : "is-todo"}`}>
                    <button type="button" className="op-nav-btn" aria-pressed={selected} onClick={() => setGroup(selected ? "all" : item.key)} title={selected ? "Bấm lần nữa để xem tất cả" : item.label}>
                      <span className="op-num" aria-hidden="true">{index + 1}</span>
                      <span className="op-text"><span className="op-label">{item.label}</span><small className="op-dept">{n ? `${n} đơn` : item.form ?? " "}</small></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {!rows ? <SkeletonTable rows={4} cols={5} /> : (() => {
            const shown = all.filter((row) => group === "all" || row.group === group).map((row) => row.order);
            return <>
              <small className="muted">{shown.length} đơn · {formatVnd(shown.reduce((sum, order) => sum + (order.totalActual ?? order.totalEstimate), 0))}. Bấm một đơn để xem tiến độ, chuỗi ký và tệp của đơn.</small>
              <PurchaseList orders={shown} projects={[data.project]} pending={pending} onOpen={(id) => open(id)} hideProject />
            </>;
          })()}
        </section>
      )}

      {view === "payments" && (
        <section className="panel pj-section" aria-labelledby="pj-rfp-title">
          <div className="pj-section-head">
            <h2 id="pj-rfp-title">Đề nghị thanh toán (P-CF-03)</h2>
            <div className="pj-subtabs" role="tablist" aria-label="Lọc đề nghị">
              <button type="button" role="tab" aria-selected={payFilter === "open"} onClick={() => setPayFilter("open")}>Đang xử lý ({openPays.length})</button>
              <button type="button" role="tab" aria-selected={payFilter === "all"} onClick={() => setPayFilter("all")}>Tất cả ({payRows.length})</button>
            </div>
          </div>
          <small className="muted">Tạm ứng, thanh toán trước giao và thanh toán còn lại cho NCC. Lập đề nghị mới ngay trong đơn hàng; bấm một dòng để mở đơn ở đúng bước của đề nghị.</small>
          {!rows ? <SkeletonTable rows={4} /> : (() => {
            const shown = payFilter === "open" ? openPays : payRows;
            const sum = (status: PurchasePayment["status"]) => payRows.filter((row) => row.payment.status === status).reduce((total, row) => total + row.payment.amount + row.payment.vatAmount, 0);
            return <>
              <div className="pj-kpis">
                <div className="pj-kpi warn"><span>Chờ duyệt</span><b>{formatVnd(sum("requested"))}</b></div>
                <div className="pj-kpi warn"><span>Chờ chi</span><b>{formatVnd(sum("approved"))}</b></div>
                <div className="pj-kpi"><span>Đã chi</span><b>{formatVnd(sum("paid"))}</b></div>
              </div>
              {!shown.length ? <p className="muted">{payFilter === "open" ? "Không có đề nghị nào đang chờ." : "Chưa có đề nghị thanh toán nào."}</p> : (
                <div className="table-scroll">
                  <table className="pj-table">
                    <thead><tr><th>Đề nghị</th><th>Đơn / PO</th><th>Loại</th><th>Người nhận</th><th className="pj-num">Giá trị</th><th>Tiến độ</th></tr></thead>
                    <tbody>{shown.map(({ payment, order }) => {
                      const [requestStep, payStep] = PAY_STEP[payment.kind];
                      const step = payment.status === "approved" || payment.status === "paid" ? payStep : requestStep;
                      const stage = payment.status === "rejected" ? -1 : payment.status === "requested" ? 1 : payment.status === "approved" ? 2 : 3;
                      return (
                        <tr key={payment.id} className="mr-row" onClick={() => open(order.id, step)}>
                          <td><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); open(order.id, step); }}><b>{payment.rfpNo || "—"}</b></button><br /><small className="muted">{dmy(payment.requestedAt)}</small></td>
                          <td>{order.poNo || order.code}<br /><small className="muted">{order.title}</small></td>
                          <td>{PAYMENT_KIND_LABELS[payment.kind]}</td>
                          <td>{payment.payee || order.supplier || "—"}</td>
                          <td className="pj-num"><b>{formatVnd(payment.amount + payment.vatAmount)}</b>{payment.vatAmount ? <><br /><small className="muted">VAT {formatVnd(payment.vatAmount)}</small></> : null}</td>
                          <td>
                            <div className="op-mini">
                              <div className="op-mini-bar" role="img" aria-label={PURCHASE_PAYMENT_STATUS_LABELS[payment.status]}>
                                {["Đề nghị, ký", "Duyệt", "Chi"].map((label, index) => <span key={label} className={stage < 0 ? "is-todo" : index + 1 < stage || stage === 3 ? "is-done" : index + 1 === stage ? "is-current" : "is-todo"} />)}
                              </div>
                              <small className={stage < 0 ? "warn-text" : undefined}><span className={`pill ${PAY_TONE[payment.status]}`}>{PURCHASE_PAYMENT_STATUS_LABELS[payment.status]}</span>{payment.paidAt ? ` · chi ${dmy(payment.paidAt)}` : ""}</small>
                            </div>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
            </>;
          })()}
        </section>
      )}

      {creating && <PurchaseFormModal store={purchases} projects={[data.project]} initial={null} defaultProjectId={data.project.id} lockProject onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi ký duyệt.` : `Đã lưu nháp ${order.code}.`, "success"); open(order.id); }} />}
    </>
  );
}
