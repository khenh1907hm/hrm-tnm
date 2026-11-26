"use client";
import { SkeletonTable } from "../Skeleton";
import { useEffect, useState } from "react";
import { formatVnd } from "../../../modules/projects/cost";
import { PAYMENT_KIND_LABELS, PURCHASE_PAYMENT_STATUS_LABELS, type PurchaseOrder, type PurchasePayment } from "../../../modules/purchases/types";
import type { TabProps } from "../projects/ProjectDetail";
import { errorMessage } from "../projects/projectShared";
import { ProjectOrderDetail, useProjectOrder } from "./ProjectOrderDetail";
import { getPurchaseStore } from "./usePurchaseStore";
import "./purchases.css";

const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
const TONE: Record<PurchasePayment["status"], string> = { requested: "warn", approved: "warn", paid: "ok", rejected: "bad" };

/**
 * Tab Request for Payment (P-CF-03): mọi đề nghị thanh toán cho NCC của dự án (tạm ứng, trả trước, còn lại).
 * Lập đề nghị mới ở đơn Purchase Order tương ứng (bấm vào dòng để mở đơn, ký duyệt, kế toán chi, xuất form).
 */
export function ProjectPaymentsTab(props: TabProps) {
  const { store, data, setNotice } = props;
  const purchases = getPurchaseStore(store.mode);
  const { orderId, open, close } = useProjectOrder(data.project.id, "de-nghi-thanh-toan");
  const [rows, setRows] = useState<{ payment: PurchasePayment; order: PurchaseOrder }[] | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const orders = (await purchases.listOrders()).filter((order) => order.projectId === data.project.id);
      const lists = await Promise.all(orders.map((order) => purchases.listPayments(order.id).then((list) => list.map((payment) => ({ payment, order })))));
      return lists.flat().sort((a, b) => b.payment.requestedAt.localeCompare(a.payment.requestedAt));
    })().then((list) => { if (active) setRows(list); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setRows([]); } });
    return () => { active = false; };
  }, [purchases, data.project.id, setNotice]);
  if (orderId) return <ProjectOrderDetail {...props} orderId={orderId} onBack={close} />;
  const sum = (status: PurchasePayment["status"]) => (rows ?? []).filter((row) => row.payment.status === status).reduce((total, row) => total + row.payment.amount + row.payment.vatAmount, 0);
  return (
    <section className="panel pj-section" aria-labelledby="pj-rfp-title">
      <div className="pj-section-head"><h2 id="pj-rfp-title">Request for Payment (P-CF-03)</h2></div>
      <small className="muted">Đề nghị thanh toán cho nhà cung cấp. Lập đề nghị mới trong đơn ở tab Purchase Order (sau khi phát hành PO); ký duyệt xong Kế toán chi.
        {rows && rows.length > 0 && <> Chờ duyệt {formatVnd(sum("requested"))} · Chờ chi {formatVnd(sum("approved"))} · Đã chi {formatVnd(sum("paid"))}.</>}</small>
      {!rows ? <SkeletonTable rows={4} /> : !rows.length ? <p className="muted">Chưa có đề nghị thanh toán nào.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>RFP No.</th><th>PO / Đơn</th><th>Loại</th><th>Người nhận</th><th className="pj-num">Trước thuế</th><th className="pj-num">VAT</th><th className="pj-num">Tổng</th><th>Ngày đề nghị</th><th>Trạng thái</th></tr></thead>
            <tbody>{rows.map(({ payment, order }) => (
              <tr key={payment.id} style={{ cursor: "pointer" }} onClick={() => open(order.id)}>
                <td><button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); open(order.id); }}>{payment.rfpNo || "—"}</button></td>
                <td>{order.poNo || order.code}<br /><small className="muted">{order.title}</small></td>
                <td>{PAYMENT_KIND_LABELS[payment.kind]}</td>
                <td>{payment.payee || order.supplier || "—"}</td>
                <td className="pj-num">{formatVnd(payment.amount)}</td>
                <td className="pj-num">{formatVnd(payment.vatAmount)}</td>
                <td className="pj-num"><b>{formatVnd(payment.amount + payment.vatAmount)}</b></td>
                <td>{dmy(payment.requestedAt)}</td>
                <td><span className={`pill ${TONE[payment.status]}`}>{PURCHASE_PAYMENT_STATUS_LABELS[payment.status]}</span>{payment.paidAt ? <><br /><small className="muted">Chi {dmy(payment.paidAt)}</small></> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
