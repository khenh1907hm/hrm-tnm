"use client";
import type { ReactNode } from "react";
import { History, Paperclip } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import { EVENT_LABELS, eventStep, type PathKey, type PathStep } from "../../../modules/purchases/flow";
import { PAYMENT_KIND_LABELS, PURCHASE_PAYMENT_STATUS_LABELS, type PaymentKind, type PurchaseEvent, type PurchaseOrder, type PurchasePayment } from "../../../modules/purchases/types";
import type { Notify } from "../Toast";
import { SavedAttachments } from "./AttachmentsField";
import { purchaseFiles, STEP_FILE_KINDS } from "./purchaseFiles";

const dateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dmy = (date: string | null) => date ? date.slice(0, 10).split("-").reverse().join("/") : "—";
const STATE_TEXT: Record<PathStep["state"], string> = { done: "Đã xong", current: "Đang ở bước này", todo: "Chưa tới", skipped: "Không dùng" };
const PAY_OF: Partial<Record<PathKey, PaymentKind>> = { advance: "advance", advance_pay: "advance", prepayment: "prepayment", prepayment_pay: "prepayment", final: "final", final_pay: "final" };

/** Kết quả đã ghi của từng bước (số PO, ngày giao, biên bản, phiếu nhập kho, chứng từ…). */
function stepResults(key: PathKey, order: PurchaseOrder, payments: readonly PurchasePayment[]): string[] {
  const out: string[] = [];
  switch (key) {
    case "draft": case "submitted":
      out.push(`${order.items.length} dòng hàng · dự kiến ${formatVnd(order.totalEstimate)}`);
      if (order.submittedAt) out.push(`Gửi ký lúc ${dateTime(order.submittedAt)}`);
      break;
    case "approved":
      if (order.approvedAt) out.push(`Duyệt lúc ${dateTime(order.approvedAt)}`);
      if (order.decisionNote) out.push(`Ghi chú: ${order.decisionNote}`);
      break;
    case "po":
      if (order.poNo) out.push(`PO ${order.poNo} · phát hành ${order.poIssuedAt ? dateTime(order.poIssuedAt) : "—"}`);
      out.push(order.supplierAcceptedAt ? `NCC ký nhận ${dateTime(order.supplierAcceptedAt)}${order.supplierAcceptNote ? ` · ${order.supplierAcceptNote}` : ""}` : "Chờ NCC ký nhận PO");
      break;
    case "ordered":
      if (order.orderedAt) out.push(`Đặt hàng lúc ${dateTime(order.orderedAt)} · NCC ${order.supplier || "—"}`);
      out.push(`Ngày giao dự kiến: ${dmy(order.expectedDelivery ?? order.neededBy)}`);
      break;
    case "received":
      if (order.receivedAt) out.push(`Nhận hàng lúc ${dateTime(order.receivedAt)}${order.receiptRecordNo ? ` · Biên bản ${order.receiptRecordNo}` : ""}`);
      if (order.totalActual !== null) out.push(`Thực nhận ${formatVnd(order.totalActual)}`);
      break;
    case "stocked":
      if (order.stockedAt) out.push(`Phiếu nhập kho ${order.stockReceiptNo} · ${dateTime(order.stockedAt)}${order.stockLocation ? ` · ${order.stockLocation}` : ""}${order.stockedByName ? ` · ${order.stockedByName}` : ""}`);
      break;
    case "docs":
      if (order.docsCollectedAt) out.push(`Đủ chứng từ ${dateTime(order.docsCollectedAt)}${order.docsNote ? ` · ${order.docsNote}` : ""}`);
      break;
    case "completed":
      if (order.completedAt) out.push(`Hoàn tất ${dateTime(order.completedAt)}`);
      break;
    default: {
      const kind = PAY_OF[key];
      for (const payment of payments.filter((item) => item.kind === kind)) {
        out.push(`${payment.rfpNo || PAYMENT_KIND_LABELS[payment.kind]}: ${formatVnd(payment.amount + payment.vatAmount)} · ${PURCHASE_PAYMENT_STATUS_LABELS[payment.status]}${payment.paidAt ? ` · chi ${dateTime(payment.paidAt)}${payment.paidMethod ? ` (${payment.paidMethod})` : ""}` : ""}`);
      }
    }
  }
  return out;
}

/**
 * Khung dưới thanh tiến trình khi bấm vào một bước: lịch sử của bước, kết quả đã ghi, biểu mẫu tải về
 * và tệp đính kèm của bước (ảnh chụp, PDF, bản scan; PDF xem tách từng trang).
 */
export function StepDetail(props: {
  step: PathStep; order: PurchaseOrder; payments: readonly PurchasePayment[]; events: readonly PurchaseEvent[];
  forms?: ReactNode; /** Thông tin riêng của bước (bảng hàng, khoản chi…). */ extra?: ReactNode; live: boolean; editable: boolean; setNotice: Notify;
}) {
  const { step, order, payments } = props;
  const history = props.events.filter((event) => eventStep(event, payments) === step.key);
  const results = stepResults(step.key, order, payments);
  const kinds = STEP_FILE_KINDS[step.key] ?? [];
  return (
    <section className="sd" aria-label={`Bước ${step.label}`}>
      <div className="sd-head">
        <h3>{step.label} <span className={`pill ${step.state === "done" ? "ok" : step.state === "current" ? "warn" : ""}`}>{STATE_TEXT[step.state]}</span></h3>
        {props.forms && <span className="po-forms">{props.forms}</span>}
      </div>
      {props.extra && <div className="sd-extra">{props.extra}</div>}
      <div className="sd-grid">
        <div>
          <h4>Kết quả</h4>
          {results.length ? <ul className="sd-results">{results.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="muted">Chưa có kết quả.</p>}
          <h4 style={{ marginTop: 10 }}><History size={13} aria-hidden="true" /> Lịch sử</h4>
          {!history.length ? <p className="muted">Chưa có hoạt động ở bước này.</p> : (
            <ol className="po-timeline">{[...history].reverse().map((event) => (
              <li key={event.id}><time dateTime={event.at}>{dateTime(event.at)}</time><span><b>{EVENT_LABELS[event.action] ?? event.action}</b>{event.actorName ? ` · ${event.actorName}` : ""}{event.note ? <><br /><span className="muted">{event.note}</span></> : null}</span></li>
            ))}</ol>
          )}
        </div>
        {kinds.length > 0 && (
          <div>
            <h4><Paperclip size={13} aria-hidden="true" /> Tệp của bước (ảnh, PDF, bản scan)</h4>
            {props.live
              ? <SavedAttachments parentId={order.id} api={purchaseFiles} kinds={kinds} editable={props.editable} requireSigned={false} setNotice={props.setNotice} onlyKinds />
              : <p className="muted">Đính kèm tệp cần chế độ đăng nhập thật.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
