"use client";
import { ExternalLink } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { Project } from "../../../modules/projects/types";
import type { PurchaseOrder, PurchasePayment, PurchaseStatus } from "../../../modules/purchases/types";
import { OrderMiniPath } from "./OrderProgress";
import "../approvalBoard.css";

/** Cột của bảng đơn hàng theo tình trạng (đơn hủy không hiện, lọc "Đã hủy" ở danh sách). */
const COLUMNS: readonly { key: string; title: string; hint: string; statuses: readonly PurchaseStatus[] }[] = [
  { key: "draft", title: "Nháp / bị trả về", hint: "Người lập đang soạn hoặc sửa theo góp ý.", statuses: ["draft", "rejected"] },
  { key: "signing", title: "Đang ký duyệt", hint: "Đã gửi, đang chờ các khối ký.", statuses: ["submitted"] },
  { key: "approved", title: "Đã duyệt · PO", hint: "Phát hành PO, NCC ký nhận, tạm ứng (nếu có).", statuses: ["approved"] },
  { key: "ordered", title: "Đang giao hàng", hint: "Đã đặt, theo dõi đến khi hàng về.", statuses: ["ordered"] },
  { key: "received", title: "Nhận hàng · chứng từ", hint: "Nhập kho, thu hóa đơn chứng từ, thanh toán.", statuses: ["received"] },
  { key: "completed", title: "Hoàn tất", hint: "Đơn đã xong.", statuses: ["completed"] },
];

/**
 * Xem nhanh các đơn đang ở tình trạng nào: mỗi cột một nhóm tình trạng, mỗi thẻ có dải các bước của đơn và bước hiện tại.
 * Người dùng thấy đơn của mình, quản lý (xem tất cả) thấy mọi đơn — lọc theo tab ở trên.
 */
export function PurchaseBoard(props: { orders: readonly PurchaseOrder[]; projects: readonly Project[]; pending: readonly PurchasePayment[]; onOpen: (id: string) => void; hideProject?: boolean }) {
  return (
    <div className="ab-board po-board">
      {COLUMNS.map((column) => {
        const list = props.orders.filter((order) => column.statuses.includes(order.status));
        return (
          <div key={column.key} className={`ab-col po-col-${column.key}`}>
            <header><b>{column.key === "approved" && props.hideProject ? "Đã duyệt" : column.title}</b><span className="ab-count">{list.length}</span></header>
            <small className="ab-hint muted">{column.key === "approved" && props.hideProject ? "Sếp đã duyệt, chờ đặt hàng." : column.hint}</small>
            <div className="ab-cards">
              {list.length ? list.map((order) => {
                const project = order.projectId ? props.projects.find((item) => item.id === order.projectId) : null;
                const pays = props.pending.filter((payment) => payment.orderId === order.id);
                return (
                  <article key={order.id} className={`ab-card po-card${order.status === "rejected" ? " late" : ""}`} onClick={() => props.onOpen(order.id)}>
                    <div className="ab-card-top">
                      <span className="ab-type">{order.code}</span>
                      {!props.hideProject && project && <span className="pill">{project.code}</span>}
                      {order.poNo && <span className="pill ok">{order.poNo}</span>}
                    </div>
                    <b className="ab-title">{order.title || "—"}</b>
                    <span className="ab-amount">{formatVnd(order.totalActual ?? order.totalEstimate)}</span>
                    <OrderMiniPath order={order} payments={pays} />
                    {pays.some((payment) => payment.status === "requested") && <small className="warn-text">Có khoản chi chờ duyệt</small>}
                    {pays.some((payment) => payment.status === "approved") && <small className="warn-text">Có khoản chờ kế toán chi</small>}
                    <small className="muted">{order.supplier ? `${order.supplier} · ` : ""}Người lập: {order.requesterName || "—"}</small>
                    <div className="ab-actions">
                      <button type="button" className="link-button" onClick={(event) => { event.stopPropagation(); props.onOpen(order.id); }}><ExternalLink size={13} aria-hidden="true" /> Mở đơn</button>
                    </div>
                  </article>
                );
              }) : <p className="ab-empty muted">Không có đơn.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
