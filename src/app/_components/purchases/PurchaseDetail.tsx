"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, PackageCheck, Pencil, Send, Truck, X } from "lucide-react";
import { formatVnd } from "../../../modules/projects/cost";
import type { Project } from "../../../modules/projects/types";
import { allowedActions, EVENT_LABELS, lineTotal, nextHint, orderBlock, paymentIssue, paymentSummary, stepStates } from "../../../modules/purchases/flow";
import { FlowStepper } from "./FlowBar";
import type { PurchaseStore } from "../../../modules/purchases/store";
import {
  PAYMENT_KIND_LABELS, PURCHASE_KIND_LABELS, PURCHASE_PAYMENT_STATUS_LABELS, PURCHASE_STATUS_LABELS, type PaymentKind, type PaymentRequestInput, type PurchaseEvent, type ReceiptRecord, type PurchaseOrder, type PurchasePayment, type PurchaseRoles,
} from "../../../modules/purchases/types";
import type { Notify } from "../Toast";
import { errorMessage, moneyInput, parseMoney, projectText } from "../projects/projectShared";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { ApprovalChain } from "./ApprovalChain";
import { BudgetCheckBox } from "./BudgetCheckBox";
import { budgetCheck } from "../../../modules/purchases/budget";

export const STATUS_TONE: Record<PurchaseOrder["status"], string> = { draft: "", submitted: "warn", approved: "ok", rejected: "bad", ordered: "warn", received: "ok", completed: "ok", cancelled: "" };
const PAY_TONE: Record<PurchasePayment["status"], string> = { requested: "warn", approved: "warn", paid: "ok", rejected: "bad" };
const dateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dmy = (date: string | null) => date ? date.split("-").reverse().join("/") : "—";

/** Chi tiết một đơn hàng: thanh tiến trình, các nút theo vai trò (PUR-04), khoản chi, theo dõi, nhận hàng, nhật ký. */
export function PurchaseDetail(props: { store: PurchaseStore; orderId: string; projects: readonly Project[]; roles: PurchaseRoles; userId: string; isAdmin: boolean; leadProjectIds: ReadonlySet<string>; onBack: () => void; onChanged: () => void; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [order, setOrder] = useState<PurchaseOrder | null | undefined>(undefined);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [events, setEvents] = useState<PurchaseEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<"order" | "payment" | "track" | "receive" | "issuePo" | null>(null);
  const [chainKey, setChainKey] = useState(0);

  const fetchAll = useCallback(() => Promise.all([store.getOrder(props.orderId), store.listPayments(props.orderId), store.listEvents(props.orderId)]), [store, props.orderId]);
  const apply = useCallback(([next, pays, logs]: Awaited<ReturnType<typeof fetchAll>>) => { setOrder(next); setPayments(pays); setEvents(logs); }, []);
  const reload = useCallback(async () => { try { apply(await fetchAll()); props.onChanged(); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchAll, apply, props, setNotice]);
  useEffect(() => {
    let active = true;
    void fetchAll().then((result) => { if (active) apply(result); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setOrder(null); } });
    return () => { active = false; };
  }, [fetchAll, apply, setNotice]);

  const act = async (action: () => Promise<unknown>, done: string) => {
    try { await action(); setNotice(done, "success"); setPanel(null); await reload(); } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const ask = (question: string, min = 3) => { const answer = window.prompt(question) ?? ""; return answer.trim().length >= min ? answer.trim() : null; };

  if (order === undefined) return <div className="loading">Đang tải đơn hàng…</div>;
  if (order === null) return <section className="pj-page"><div className="panel empty-state"><p>Không tìm thấy đơn hàng, hoặc bạn không có quyền xem.</p><button type="button" className="button" onClick={props.onBack}>Về danh sách</button></div></section>;

  const project = order.projectId ? props.projects.find((item) => item.id === order.projectId) : null;
  const me = { userId: props.userId, isAdmin: props.isAdmin, isProjectLead: order.projectId ? props.leadProjectIds.has(order.projectId) : false, ...props.roles };
  const actions = allowedActions(order, me, payments);
  const steps = stepStates(order, payments);
  const summary = paymentSummary(order, payments);
  const requestKinds = ([["advance", "requestAdvance"], ["prepayment", "requestPrepayment"], ["final", "requestFinal"]] as const).filter(([, action]) => actions.has(action)).map(([kind]) => kind);

  return (
    <section className="pj-page">
      <div>
        <button type="button" className="back-button" onClick={props.onBack}><ArrowLeft className="ico" size={16} aria-hidden="true" /> Danh sách đơn hàng</button>
        <div className="page-head">
          <div>
            <span className="pj-code">{order.code} · {PURCHASE_KIND_LABELS[order.kind]}{project ? ` · ${project.code} ${project.name}` : order.department ? ` · ${order.department}` : ""}</span>
            <h1>{order.title}</h1>
            <p>Người lập: {order.requesterName || "—"} · Lập lúc {dateTime(order.createdAt)}{order.neededBy ? ` · Cần trước ${dmy(order.neededBy)}` : ""}</p>
          </div>
          <span className={`pill ${STATUS_TONE[order.status]}`} style={{ fontSize: 14 }}>{PURCHASE_STATUS_LABELS[order.status]}</span>
        </div>
      </div>

      <section className="panel pj-section" aria-label="Tiến trình đơn hàng">
        <FlowStepper states={steps} cancelled={order.status === "cancelled"} hint={nextHint(order, { userId: props.userId, ...props.roles }, payments)} />
        {order.status === "rejected" && <p className="warn-text">{order.usesChain ? "Bị trả về" : "Sếp từ chối"}: {order.decisionNote}. Sửa đơn rồi lập lại.</p>}
        {order.status === "cancelled" && <p className="warn-text">Đơn đã hủy: {order.decisionNote}</p>}
        <div className="po-actions">
          {actions.has("edit") && <button type="button" className="button" onClick={() => setEditing(true)}><Pencil className="ico" size={16} aria-hidden="true" /> Sửa đơn</button>}
          {actions.has("submit") && <button type="button" className="button primary" onClick={() => void act(async () => { await store.submit(order.id); setChainKey((value) => value + 1); }, order.kind === "project" ? "Đã lập đơn, gửi ký duyệt." : "Đã lập đơn, gửi sếp duyệt.")}><Send className="ico" size={16} aria-hidden="true" /> Lập đơn, gửi duyệt</button>}
          {actions.has("approve") && <button type="button" className="button primary" onClick={() => void act(() => store.decide(order.id, true, window.prompt("Ghi chú khi duyệt (có thể để trống):") ?? ""), "Đã duyệt đơn hàng.")}><Check className="ico" size={16} aria-hidden="true" /> Duyệt đơn</button>}
          {actions.has("reject") && <button type="button" className="button danger" onClick={() => { const why = ask("Lý do từ chối (ít nhất 3 ký tự):"); if (why) void act(() => store.decide(order.id, false, why), "Đã từ chối, đơn trả về người lập."); }}><X className="ico" size={16} aria-hidden="true" /> Từ chối</button>}
          {actions.has("issuePo") && <button type="button" className="button primary" onClick={() => setPanel("issuePo")}><Send className="ico" size={16} aria-hidden="true" /> Phát hành PO</button>}
          {actions.has("supplierAccept") && <button type="button" className="button primary" onClick={() => { const note = window.prompt("NCC đã ký bản sao PO gửi lại. Ghi chú (ngày ký, nơi lưu bản ký…):", ""); if (note !== null) void act(() => store.supplierAccept(order.id, note), "Đã ghi nhận NCC ký xác nhận PO. PO có hiệu lực."); }}><Check className="ico" size={16} aria-hidden="true" /> NCC đã ký xác nhận PO</button>}
          {actions.has("order") && <button type="button" className="button primary" onClick={() => setPanel("order")}><Truck className="ico" size={16} aria-hidden="true" /> Đặt hàng</button>}
          {requestKinds.length > 0 && <button type="button" className="button" onClick={() => setPanel("payment")}>Đề nghị {requestKinds.map((kind) => PAYMENT_KIND_LABELS[kind].toLowerCase()).join(" / ")}</button>}
          {actions.has("track") && order.status !== "approved" && <button type="button" className="button" onClick={() => setPanel("track")}>Cập nhật theo dõi</button>}
          {actions.has("receive") && <button type="button" className="button primary" onClick={() => setPanel("receive")}><PackageCheck className="ico" size={16} aria-hidden="true" /> Nhận hàng, kiểm tra</button>}
          {actions.has("complete") && <button type="button" className="button primary" onClick={() => void act(() => store.complete(order.id, ""), order.kind === "project" ? "Đã hoàn tất. Tiền thực nhận đã ghi vào chi phí vật tư của dự án." : "Đã hoàn tất đơn hàng.")}><Check className="ico" size={16} aria-hidden="true" /> Hoàn tất đơn</button>}
          {actions.has("cancel") && <button type="button" className="button danger" onClick={() => { const why = ask("Lý do hủy đơn (ít nhất 3 ký tự):"); if (why) void act(() => store.cancel(order.id, why), "Đã hủy đơn."); }}>Hủy đơn</button>}
        </div>
        {panel === "order" && <OrderPanel order={order} onCancel={() => setPanel(null)} onSubmit={(supplier, contact, expected, note) => act(() => store.markOrdered(order.id, supplier, contact, expected, note), "Đã đặt hàng, bắt đầu theo dõi.")} />}
        {panel === "payment" && <PaymentPanel kinds={requestKinds} order={order} payments={payments} remaining={Math.max(0, summary.remaining - summary.pending)} onCancel={() => setPanel(null)}
          onSubmit={(input) => act(async () => { await store.requestPayment(order.id, input); setChainKey((value) => value + 1); }, `Đã gửi đề nghị ${PAYMENT_KIND_LABELS[input.kind].toLowerCase()} ${order.usesChain ? "đi ký duyệt" : "cho sếp duyệt"}.`)} />}
        {actions.has("track") && order.status === "approved" && orderBlock(order, payments) && <p className="warn-text">{projectText("PO_ADVANCE_NOT_PAID")}</p>}
        {panel === "track" && <TrackPanel expected={order.expectedDelivery} onCancel={() => setPanel(null)} onSubmit={(note, expected) => act(() => store.track(order.id, note, expected), "Đã cập nhật theo dõi.")} />}
        {panel === "receive" && <ReceivePanel order={order} onCancel={() => setPanel(null)} onSubmit={(lines, note, record) => act(() => store.receive(order.id, lines, note, record), "Đã ghi nhận hàng và kết quả kiểm tra.")} />}
        {panel === "issuePo" && <IssuePoPanel order={order} onCancel={() => setPanel(null)} onSubmit={(supplier, contact) => act(() => store.issuePo(order.id, supplier, contact), "Đã phát hành PO. Gửi PO cho nhà cung cấp ký xác nhận.")} />}
        {order.poNo && <p className="po-terms-line">PO chính thức: <b>{order.poNo}</b> · phát hành {order.poIssuedAt ? dateTime(order.poIssuedAt) : "—"} · {order.supplierAcceptedAt ? <span className="pill ok">NCC đã ký nhận {dateTime(order.supplierAcceptedAt)}</span> : <span className="pill warn">Chờ NCC ký nhận</span>}{order.supplierAcceptNote ? ` · ${order.supplierAcceptNote}` : ""}{order.receiptRecordNo ? ` · Biên bản giao nhận ${order.receiptRecordNo}` : ""}</p>}
      </section>

      {order.usesChain && order.budgetCode && order.budgetA !== null && order.budgetB !== null && (
        <BudgetCheckBox title="Xác nhận đặt hàng (P-CC-07)" check={budgetCheck(order.budgetCode, "", order.budgetA, order.budgetB, order.totalEstimate)} />
      )}
      {order.usesChain && <ApprovalChain store={store} docType="purchase" docId={order.id} refreshKey={chainKey} title="Chuỗi ký đơn đặt hàng" onChanged={() => void reload()} setNotice={setNotice} />}

      <section className="panel pj-section" aria-labelledby="po-items-title">
        <h2 id="po-items-title">Hàng cần mua</h2>
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Tên hàng</th><th>Quy cách</th><th>ĐVT</th><th className="pj-num">SL đặt</th><th className="pj-num">Đơn giá</th><th className="pj-num">Thành tiền</th>{order.receivedAt && <><th className="pj-num">SL nhận</th><th className="pj-num">SL đạt</th><th>Kiểm tra</th></>}</tr></thead>
            <tbody>{order.items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.spec}</td><td>{item.unit}</td>
                <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td><td className="pj-num">{formatVnd(item.unitPrice)}</td><td className="pj-num">{formatVnd(lineTotal(item))}</td>
                {order.receivedAt && <><td className="pj-num">{item.receivedQty.toLocaleString("vi-VN")}</td><td className={`pj-num ${item.acceptedQty < item.quantity ? "warn-text" : ""}`}>{item.acceptedQty.toLocaleString("vi-VN")}</td><td>{item.inspectionNote}</td></>}
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={5}>Tổng dự kiến{order.totalActual !== null ? " / thực nhận" : ""}</td><td className="pj-num">{formatVnd(order.totalEstimate)}</td>{order.receivedAt && <td colSpan={3} className="pj-num">Thực nhận: {formatVnd(order.totalActual ?? 0)}</td>}</tr></tfoot>
          </table>
        </div>
        <dl className="po-inline" style={{ margin: 0 }}>
          <div><dt className="muted">Nhà cung cấp</dt><dd style={{ margin: 0 }}>{order.supplier || "—"}{order.supplierContact ? ` · ${order.supplierContact}` : ""}</dd></div>
          <div><dt className="muted">Giao dự kiến</dt><dd style={{ margin: 0 }}>{dmy(order.expectedDelivery)}</dd></div>
          <div><dt className="muted">Giao tới</dt><dd style={{ margin: 0 }}>{order.deliveryAddress || "—"}</dd></div>
          {order.note && <div><dt className="muted">Ghi chú</dt><dd style={{ margin: 0 }}>{order.note}</dd></div>}
        </dl>
      </section>

      <section className="panel pj-section" aria-labelledby="po-pay-title">
        <h2 id="po-pay-title">Tạm ứng và thanh toán</h2>
        <p className="po-terms-line">Điều kiện NCC: <span className={`pill ${order.advanceRequired ? "warn" : ""}`}>{order.advanceRequired ? `Cần tạm ứng${order.advancePct ? ` ${order.advancePct}%` : ""}` : "Không tạm ứng"}</span> <span className={`pill ${order.prepayRequired ? "warn" : ""}`}>{order.prepayRequired ? "Thanh toán trước khi giao" : "Thanh toán sau khi nhận hàng"}</span></p>
        <div className="pj-kpis">
          <div className="pj-kpi"><span>Đã chi tạm ứng</span><b>{formatVnd(summary.advance)}</b></div>
          <div className="pj-kpi"><span>Đã chi thanh toán</span><b>{formatVnd(summary.prepayment + summary.final)}</b><small>Trước {formatVnd(summary.prepayment)} · Còn lại {formatVnd(summary.final)}</small></div>
          <div className={`pj-kpi ${summary.pending ? "warn" : ""}`}><span>Đang chờ duyệt / chờ chi</span><b>{formatVnd(summary.pending)}</b></div>
          <div className={`pj-kpi ${summary.remaining < 0 ? "over" : ""}`}><span>Còn phải trả</span><b>{formatVnd(summary.remaining)}</b><small>So với tổng {order.totalActual !== null ? "thực nhận" : "dự kiến"}</small></div>
        </div>
        {!payments.length ? <p className="muted">Chưa có khoản tạm ứng hay thanh toán nào.</p> : (
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>Đề nghị</th><th>Hóa đơn</th><th className="pj-num">Trước thuế</th><th className="pj-num">Thuế GTGT</th><th className="pj-num">Giá trị</th><th>Người nhận</th><th>Nội dung</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>{payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{PAYMENT_KIND_LABELS[payment.kind]}{payment.rfpNo ? <><br /><b>{payment.rfpNo}</b></> : null}<br /><small className="muted">{dateTime(payment.requestedAt)}</small></td>
                  <td>{payment.invoiceNo || "—"}{payment.invoiceDate ? <><br /><small className="muted">{dmy(payment.invoiceDate)}</small></> : null}</td>
                  <td className="pj-num">{formatVnd(payment.amount)}</td>
                  <td className="pj-num">{payment.vatAmount ? formatVnd(payment.vatAmount) : "—"}</td>
                  <td className="pj-num"><b>{formatVnd(payment.amount + payment.vatAmount)}</b></td>
                  <td>{payment.payee}</td>
                  <td>{payment.note}{payment.decisionNote && <><br /><small className="muted">{payment.decisionNote}</small></>}</td>
                  <td><span className={`pill ${PAY_TONE[payment.status]}`}>{PURCHASE_PAYMENT_STATUS_LABELS[payment.status]}</span>{payment.paidAt && <><br /><small className="muted">{dateTime(payment.paidAt)}{payment.paidMethod ? ` · ${payment.paidMethod}` : ""}</small></>}</td>
                  <td className="po-actions">
                    {payment.status === "requested" && props.roles.isApprover && !payment.usesChain && <>
                      <button type="button" className="button primary" onClick={() => void act(() => store.decidePayment(payment.id, true, ""), "Đã duyệt khoản chi.")}>Duyệt</button>
                      <button type="button" className="button danger" onClick={() => { const why = ask("Lý do từ chối khoản chi:"); if (why) void act(() => store.decidePayment(payment.id, false, why), "Đã từ chối khoản chi."); }}>Từ chối</button>
                    </>}
                    {payment.status === "approved" && props.roles.isPayer && <button type="button" className="button primary" onClick={() => { const method = window.prompt("Hình thức chi (vd: Chuyển khoản Vietcombank, Tiền mặt):", "Chuyển khoản"); if (method !== null) void act(() => store.pay(payment.id, method, ""), "Đã thực hiện chi."); }}>Thực hiện chi</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {payments.filter((payment) => payment.usesChain && payment.status !== "rejected").map((payment) => (
        <ApprovalChain key={payment.id} store={store} docType="payment" docId={payment.id} refreshKey={chainKey} title={`Ký đề nghị ${PAYMENT_KIND_LABELS[payment.kind].toLowerCase()} ${payment.rfpNo}`} onChanged={() => void reload()} setNotice={setNotice} />
      ))}

      <section className="panel pj-section" aria-labelledby="po-log-title">
        <h2 id="po-log-title">Theo dõi đơn hàng</h2>
        {!events.length ? <p className="muted">Chưa có hoạt động.</p> : (
          <ol className="po-timeline">{[...events].reverse().map((event) => (
            <li key={event.id}><time dateTime={event.at}>{dateTime(event.at)}</time><span><b>{EVENT_LABELS[event.action] ?? event.action}</b>{event.actorName ? ` · ${event.actorName}` : ""}{event.note ? <><br /><span className="muted">{event.note}</span></> : null}</span></li>
          ))}</ol>
        )}
      </section>

      {editing && <PurchaseFormModal store={store} projects={props.projects} initial={order} onClose={() => setEditing(false)} onSaved={(_, submitted) => { setEditing(false); setNotice(submitted ? "Đã lập đơn, gửi sếp duyệt." : "Đã lưu nháp.", "success"); void reload(); }} />}
    </section>
  );
}

function OrderPanel(props: { order: PurchaseOrder; onCancel: () => void; onSubmit: (supplier: string, contact: string, expected: string | null, note: string) => Promise<void> }) {
  const [supplier, setSupplier] = useState(props.order.supplier);
  const [contact, setContact] = useState(props.order.supplierContact);
  const [expected, setExpected] = useState(props.order.neededBy ?? "");
  const [note, setNote] = useState("");
  return (
    <div className="po-inline">
      <label className="field"><span>Nhà cung cấp *</span><input value={supplier} autoFocus onChange={(event) => setSupplier(event.target.value)} /></label>
      <label className="field"><span>Liên hệ</span><input value={contact} onChange={(event) => setContact(event.target.value)} /></label>
      <label className="field"><span>Ngày giao dự kiến</span><input type="date" value={expected} onChange={(event) => setExpected(event.target.value)} /></label>
      <label className="field"><span>Ghi chú (số PO, báo giá…)</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" onClick={() => void props.onSubmit(supplier, contact, expected || null, note)}>Xác nhận đặt hàng</button></div>
    </div>
  );
}

/** Đề nghị tạm ứng / thanh toán (P-CF-03): tiền trước thuế, thuế GTGT, số và ngày hóa đơn (tạm ứng ghi "tạm ứng"). */
function PaymentPanel(props: { kinds: PaymentKind[]; order: PurchaseOrder; payments: readonly PurchasePayment[]; remaining: number; onCancel: () => void; onSubmit: (input: PaymentRequestInput) => Promise<void> }) {
  const { order } = props;
  const advanceAmount = order.advancePct ? Math.round((order.totalActual ?? order.totalEstimate) * order.advancePct / 100) : props.remaining;
  const [kind, setKind] = useState<PaymentKind>(props.kinds[0]!);
  const [amount, setAmount] = useState(props.kinds[0] === "advance" ? Math.min(advanceAmount, props.remaining) : props.remaining);
  const [vat, setVat] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [payee, setPayee] = useState(order.supplier);
  const [note, setNote] = useState("");
  const isAdvance = kind === "advance";
  const issue = paymentIssue(order, props.payments, { kind, amount, vatAmount: vat, invoiceNo });
  return (
    <div className="po-inline">
      <label className="field"><span>Loại</span><select value={kind} onChange={(event) => { const next = event.target.value as PaymentKind; setKind(next); setAmount(next === "advance" ? Math.min(advanceAmount, props.remaining) : props.remaining); }}>{props.kinds.map((item) => <option key={item} value={item}>{PAYMENT_KIND_LABELS[item]}</option>)}</select></label>
      <label className="field"><span>Số tiền trước thuế (VNĐ) *</span><input inputMode="numeric" autoFocus value={moneyInput(amount)} onChange={(event) => setAmount(parseMoney(event.target.value))} /><small className="field-hint">Còn có thể đề nghị {formatVnd(props.remaining)}</small></label>
      <label className="field"><span>Thuế GTGT (VNĐ)</span><input inputMode="numeric" value={moneyInput(vat)} onChange={(event) => setVat(parseMoney(event.target.value))} />
        <span className="button-row"><button type="button" className="link-button" onClick={() => setVat(Math.round(amount * 0.08))}>8%</button><button type="button" className="link-button" onClick={() => setVat(Math.round(amount * 0.1))}>10%</button></span></label>
      {isAdvance
        ? <p className="field"><span>Số hóa đơn</span><small className="field-hint">Tạm ứng: ghi “tạm ứng”, hóa đơn nộp khi thanh toán.</small></p>
        : <>
          <label className="field"><span>Số hóa đơn *</span><input value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} /></label>
          <label className="field"><span>Ngày hóa đơn</span><input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
        </>}
      <label className="field"><span>Người nhận</span><input value={payee} onChange={(event) => setPayee(event.target.value)} /></label>
      <label className="field"><span>Nội dung</span><input value={note} placeholder={isAdvance ? "vd: Tạm ứng 30% theo báo giá" : "vd: Thanh toán đợt 2 theo hóa đơn"} onChange={(event) => setNote(event.target.value)} /></label>
      <p className="field"><span>Giá trị đề nghị</span><b>{formatVnd(amount + vat)}</b></p>
      {issue && amount > 0 && <p className="form-error" role="alert">{projectText(issue)}</p>}
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" disabled={Boolean(issue)} onClick={() => void props.onSubmit({ kind, amount, vatAmount: vat, invoiceNo, invoiceDate: invoiceDate || null, payee, note })}>{order.usesChain ? "Gửi ký duyệt" : "Gửi sếp duyệt"}</button></div>
    </div>
  );
}

function TrackPanel(props: { expected: string | null; onCancel: () => void; onSubmit: (note: string, expected: string | null) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [expected, setExpected] = useState(props.expected ?? "");
  return (
    <div className="po-inline">
      <label className="field" style={{ gridColumn: "span 2" }}><span>Tiến độ *</span><input value={note} autoFocus placeholder="vd: NCC báo đã xuất kho, xe giao chiều mai" onChange={(event) => setNote(event.target.value)} /></label>
      <label className="field"><span>Ngày giao dự kiến</span><input type="date" value={expected} onChange={(event) => setExpected(event.target.value)} /></label>
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" disabled={note.trim().length < 2} onClick={() => void props.onSubmit(note, expected && expected !== props.expected ? expected : null)}>Lưu</button></div>
    </div>
  );
}

/** Phát hành PO chính thức (P-CC-08): xác nhận nhà cung cấp; hệ thống cấp số PO. */
function IssuePoPanel(props: { order: PurchaseOrder; onCancel: () => void; onSubmit: (supplier: string, contact: string) => Promise<void> }) {
  const [supplier, setSupplier] = useState(props.order.supplier);
  const [contact, setContact] = useState(props.order.supplierContact);
  return (
    <div className="po-inline">
      <label className="field"><span>Nhà cung cấp *</span><input value={supplier} autoFocus onChange={(event) => setSupplier(event.target.value)} /></label>
      <label className="field"><span>Người nhận PO (Ông/Bà, điện thoại)</span><input value={contact} onChange={(event) => setContact(event.target.value)} /></label>
      <p className="field"><span>Lưu ý</span><small className="field-hint">PO chỉ có hiệu lực khi NCC ký một bản sao và gửi lại (điều khoản PO). Sau đó bấm “NCC đã ký xác nhận PO”.</small></p>
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" disabled={supplier.trim().length < 2} onClick={() => void props.onSubmit(supplier, contact)}>Phát hành PO</button></div>
    </div>
  );
}

function ReceivePanel(props: { order: PurchaseOrder; onCancel: () => void; onSubmit: (lines: { id: string; receivedQty: number; acceptedQty: number; note: string }[], note: string, record: ReceiptRecord) => Promise<void> }) {
  const [recordNo, setRecordNo] = useState("");
  const [signedByBoth, setSignedByBoth] = useState(false);
  const needsRecord = props.order.usesChain;
  const [lines, setLines] = useState(() => props.order.items.map((item) => ({ id: item.id, receivedQty: item.receivedQty || item.quantity, acceptedQty: item.acceptedQty || item.quantity, note: item.inspectionNote })));
  const [note, setNote] = useState("");
  const update = (index: number, patch: Partial<(typeof lines)[number]>) => setLines((current) => current.map((line, at) => at === index ? { ...line, ...patch } : line));
  return (
    <div className="pj-page">
      <div className="table-scroll">
        <table className="pj-table po-items">
          <thead><tr><th>Hàng</th><th className="pj-num">SL đặt</th><th className="pj-num">SL nhận</th><th className="pj-num">SL đạt</th><th>Kết quả kiểm tra</th></tr></thead>
          <tbody>{props.order.items.map((item, index) => (
            <tr key={item.id}>
              <td>{item.name} <small className="muted">{item.unit}</small></td>
              <td className="pj-num">{item.quantity.toLocaleString("vi-VN")}</td>
              <td style={{ width: 110 }}><input type="number" min={0} step="any" aria-label={`Số nhận ${item.name}`} value={lines[index]!.receivedQty} onChange={(event) => update(index, { receivedQty: Number(event.target.value) })} /></td>
              <td style={{ width: 110 }}><input type="number" min={0} step="any" aria-label={`Số đạt ${item.name}`} value={lines[index]!.acceptedQty} onChange={(event) => update(index, { acceptedQty: Number(event.target.value) })} /></td>
              <td><input aria-label={`Ghi chú kiểm tra ${item.name}`} value={lines[index]!.note} placeholder="Đạt / thiếu / lỗi…" onChange={(event) => update(index, { note: event.target.value })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <label className="field"><span>Ghi chú biên bản nhận hàng</span><input value={note} placeholder="vd: Nhận tại công trường, người nhận: …" onChange={(event) => setNote(event.target.value)} /></label>
      <small className="muted">Số đạt không được lớn hơn số nhận. Tiền thực nhận = số đạt × đơn giá. Nhận nhiều đợt thì lưu lại nhiều lần.</small>
      <div className="po-inline">
        <label className="field"><span>Số biên bản giao nhận{needsRecord ? " *" : ""}</span><input value={recordNo} placeholder="vd: BBGN-0012" onChange={(event) => setRecordNo(event.target.value)} /></label>
        <label className="po-term"><input type="checkbox" checked={signedByBoth} onChange={(event) => setSignedByBoth(event.target.checked)} /><span><b>Biên bản đã có chữ ký của cả hai bên</b><small>Rủi ro hàng hóa chỉ chuyển sang bên mua khi có xác nhận bằng văn bản của cả hai bên (điều khoản PO).</small></span></label>
      </div>
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" disabled={needsRecord && (!recordNo.trim() || !signedByBoth)} onClick={() => void props.onSubmit(lines, note, { recordNo, signedByBoth })}>Lưu kết quả nhận hàng</button></div>
    </div>
  );
}
