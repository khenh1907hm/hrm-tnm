"use client";
import { useEffect, useState } from "react";
import type { PurchaseStore } from "../../../modules/purchases/store";

export type ProcurementStage = "materials" | "podraft" | "purchases" | "payments";
const STAGES: readonly { key: ProcurementStage; label: string; form: string }[] = [
  { key: "materials", label: "Material Request", form: "P-COST-08" },
  { key: "podraft", label: "PO Draft", form: "P-CC-07" },
  { key: "purchases", label: "Purchase Order", form: "P-CC-08" },
  { key: "payments", label: "Request for Payment", form: "P-CF-03" },
];
type Counts = Record<ProcurementStage, { open: number; waiting: number }>;
const DRAFT = new Set(["draft", "submitted", "rejected"]);

/**
 * Sub-nav giai đoạn mua hàng của dự án: 4 khối mũi tên nối nhau theo thứ tự quy trình
 * (Material Request → PO Draft → Purchase Order → Request for Payment), mỗi khối có số phiếu đang mở / chờ ký.
 */
export function ProcurementNav(props: { store: PurchaseStore; projectId: string; current: ProcurementStage; onSelect: (stage: ProcurementStage) => void }) {
  const { store, projectId, current } = props;
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let active = true;
    // Khoản chi đang mở (chờ ký / chờ chi) lấy một lượt cho mọi đơn, thay vì mỗi đơn một truy vấn
    void Promise.all([store.listMaterialRequests(projectId).catch(() => []), store.listOrders().catch(() => []), store.listPendingPayments().catch(() => [])]).then(([requests, all, pending]) => {
      const orders = all.filter((order) => order.projectId === projectId);
      const ids = new Set(orders.map((order) => order.id));
      const payments = pending.filter((payment) => ids.has(payment.orderId));
      if (!active) return;
      setCounts({
        materials: { open: requests.filter((r) => r.status !== "closed").length, waiting: requests.filter((r) => r.status === "submitted").length },
        podraft: { open: orders.filter((o) => DRAFT.has(o.status)).length, waiting: orders.filter((o) => o.status === "submitted").length },
        purchases: { open: orders.filter((o) => !DRAFT.has(o.status) && o.status !== "completed" && o.status !== "cancelled").length, waiting: 0 },
        payments: { open: payments.filter((p) => p.status !== "paid" && p.status !== "rejected").length, waiting: payments.filter((p) => p.status === "requested" || p.status === "approved").length },
      });
    });
    return () => { active = false; };
  }, [store, projectId, current]);

  return (
    <nav aria-label="Giai đoạn mua hàng">
      <ol className="op-track op-nav">
        {STAGES.map((stage, index) => {
          const count = counts?.[stage.key];
          const selected = props.current === stage.key;
          return (
            <li key={stage.key} className={`op-step ${selected ? "is-current" : "is-todo"}`}>
              <button type="button" className="op-nav-btn" aria-current={selected ? "page" : undefined} onClick={() => props.onSelect(stage.key)}>
                <span className="op-num" aria-hidden="true">{index + 1}</span>
                <span className="op-text">
                  <span className="op-label">{stage.label}</span>
                  <small className="op-dept">{stage.form}{count ? ` · ${count.open} mở` : ""}</small>
                </span>
                {count && count.waiting > 0 && <span className="op-badge" title="Đang chờ ký / chờ chi">{count.waiting}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
