"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { PurchaseOrder, PurchasePayment } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { errorMessage } from "../projects/projectShared";
import { purchasePath } from "../routes";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { PurchaseList } from "./PurchasesPage";
import { getPurchaseStore } from "./usePurchaseStore";
import "./purchases.css";

const open = (orderId: string) => window.history.pushState(null, "", purchasePath(orderId));

/** Tab Đặt hàng của dự án: các đơn mua cho dự án này, lập đơn mới gắn sẵn dự án. Đơn hoàn tất ghi vào chi phí vật tư. */
export function ProjectPurchasesTab({ store, data, setNotice }: TabProps) {
  const purchases = getPurchaseStore(store.mode);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [pending, setPending] = useState<PurchasePayment[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([purchases.listOrders(), purchases.listPendingPayments()]).then(([list, pays]) => { if (active) { setOrders(list.filter((order) => order.projectId === data.project.id)); setPending(pays); } }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setOrders([]); } });
    return () => { active = false; };
  }, [purchases, data.project.id, setNotice]);
  const open_ = (orders ?? []).filter((order) => order.status !== "completed" && order.status !== "cancelled");
  return (
    <section className="panel pj-section" aria-labelledby="pj-po-title">
      <div className="pj-section-head">
        <h2 id="pj-po-title">Đặt hàng cho dự án</h2>
        <button type="button" className="button primary" onClick={() => setCreating(true)}><Plus className="ico" size={16} aria-hidden="true" /> Đơn hàng mới</button>
      </div>
      {orders && <small className="muted">{open_.length} đơn đang xử lý, dự kiến {formatVnd(open_.reduce((sum, order) => sum + (order.totalActual ?? order.totalEstimate), 0))}. Khi hoàn tất, tiền thực nhận tự ghi vào chi phí vật tư và trừ vào vốn dự án.</small>}
      {!orders ? <div className="loading">Đang tải…</div> : <PurchaseList orders={orders} projects={[data.project]} pending={pending} onOpen={open} hideProject />}
      {creating && <PurchaseFormModal store={purchases} projects={[data.project]} initial={null} defaultProjectId={data.project.id} onClose={() => setCreating(false)} onSaved={(order, submitted) => { setCreating(false); setNotice(submitted ? `Đã lập đơn ${order.code}, gửi sếp duyệt.` : `Đã lưu nháp ${order.code}.`, "success"); open(order.id); }} />}
    </section>
  );
}
