"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { PurchaseOrder, PurchasePayment, PurchaseStatus } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { errorMessage } from "../projects/projectShared";
import { purchasePath } from "../routes";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { PurchaseList } from "./PurchasesPage";
import { getPurchaseStore } from "./usePurchaseStore";
import { SkeletonTable } from "../Skeleton";
import "./purchases.css";

const open = (orderId: string) => window.history.pushState(null, "", purchasePath(orderId));
/** PO Draft (P-CC-07): đơn đang lập / chờ ký / bị trả về. Purchase Order (P-CC-08): đơn đã duyệt trở đi. */
const DRAFT_STATUSES: readonly PurchaseStatus[] = ["draft", "submitted", "rejected"];

/**
 * Tab PO Draft và Purchase Order của dự án (cùng một đơn, tách theo giai đoạn):
 * PO Draft lập đơn mới, gửi ký; đơn được duyệt chuyển sang Purchase Order (phát hành PO, nhận hàng, thanh toán).
 */
export function ProjectPurchasesTab({ store, data, setNotice, view }: TabProps & { view: "draft" | "po" }) {
  const purchases = getPurchaseStore(store.mode);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([purchases.listOrders(), purchases.listPendingPayments()]).then(([list, pays]) => { if (active) { setOrders(list.filter((order) => order.projectId === data.project.id)); setPending(pays); } }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setOrders([]); } });
    return () => { active = false; };
  }, [purchases, data.project.id, setNotice]);
  const shown = (orders ?? []).filter((order) => DRAFT_STATUSES.includes(order.status) === (view === "draft"));
  const active = shown.filter((order) => order.status !== "completed" && order.status !== "cancelled");
  return (
    <section className="panel pj-section" aria-labelledby="pj-po-title">
      <div className="pj-section-head">
        <h2 id="pj-po-title">{view === "draft" ? "PO Draft (P-CC-07)" : "Purchase Order (P-CC-08)"}</h2>
        {view === "draft" && <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> New PO Draft</button>}
      </div>
      {orders && <small className="muted">{view === "draft"
        ? `${active.length} đơn nháp / chờ ký, dự kiến ${formatVnd(active.reduce((sum, order) => sum + order.totalEstimate, 0))}. Gửi ký xong, Lãnh đạo duyệt thì đơn chuyển sang tab Purchase Order.`
        : `${active.length} đơn đang xử lý, ${formatVnd(active.reduce((sum, order) => sum + (order.totalActual ?? order.totalEstimate), 0))}. Phát hành PO, nhận hàng, đề nghị thanh toán ở từng đơn. Khi hoàn tất, tiền thực nhận ghi vào chi phí vật tư.`}</small>}
      {!orders ? <SkeletonTable rows={4} cols={5} /> : <PurchaseList orders={shown} projects={[data.project]} pending={pending} onOpen={open} hideProject />}
      {creating && <PurchaseFormModal store={purchases} projects={[data.project]} initial={null} defaultProjectId={data.project.id} lockProject onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi ký duyệt.` : `Đã lưu nháp ${order.code}.`, "success"); open(order.id); }} />}
    </section>
  );
}
