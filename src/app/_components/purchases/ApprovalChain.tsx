"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardSignature, Undo2 } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { isOverdue, ROLE_LABELS, type ApprovalDocType, type ApprovalStep } from "../../../modules/purchases/approval";
import { formatVnd } from "../../../modules/projects/cost";
import type { PendingApproval, PurchaseStore } from "../../../modules/purchases/store";
import type { Notify } from "../Toast";
import { errorMessage } from "../projects/projectShared";

const dmy = (date: string) => date.split("-").reverse().join("/");
const RESULT: Record<ApprovalStep["result"], [string, string]> = { pending: ["Chờ ký", "warn"], signed: ["Đã ký", "ok"], returned: ["Trả về", "bad"], skipped: ["Bỏ qua (chưa có người)", ""] };

/** Chuỗi ký theo bộ phận của một phiếu (PRC-04): ai ký, ngày mục tiêu, nút Ký / Trả về cho người đến lượt. */
export function ApprovalChain(props: { store: PurchaseStore; docType: ApprovalDocType; docId: string; refreshKey?: unknown; onChanged: () => void; setNotice: Notify; title?: string }) {
  const { store, docType, docId, setNotice } = props;
  const [steps, setSteps] = useState<(ApprovalStep & { canSign: boolean })[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fetchSteps = useCallback(() => store.listSteps(docType, docId), [store, docType, docId]);
  useEffect(() => {
    let active = true;
    void fetchSteps().then((list) => { if (active) setSteps(list); }, () => { if (active) setSteps([]); });
    return () => { active = false; };
  }, [fetchSteps, attempt, props.refreshKey]);
  if (!steps || !steps.length) return null;
  const today = todayVN(systemClock);
  const sign = async (step: ApprovalStep, approve: boolean) => {
    const note = approve ? window.prompt(`Ký ${ROLE_LABELS[step.role]}: ghi chú (có thể để trống)`) : window.prompt("Lý do trả về (ít nhất 3 ký tự):");
    if (note === null) return;
    try {
      await store.sign(step.id, approve, note);
      setNotice(approve ? `Đã ký bước ${ROLE_LABELS[step.role]}.` : "Đã trả về cho người lập.", "success");
      setAttempt((value) => value + 1);
      props.onChanged();
    } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  return (
    <section className="panel pj-section" aria-label={props.title ?? "Chuỗi ký duyệt"}>
      <h2><ClipboardSignature className="ico" size={18} aria-hidden="true" /> {props.title ?? "Chuỗi ký duyệt"}</h2>
      <ol className="ap-chain">
        {steps.map((step) => {
          const [label, tone] = RESULT[step.result];
          const late = isOverdue(step, today);
          return (
            <li key={step.id} className={`ap-step ${step.result}${step.canSign ? " mine" : ""}`}>
              <span className="ap-seq">{step.seq}</span>
              <div className="ap-body">
                <b>{ROLE_LABELS[step.role]}</b>
                <small className={late ? "warn-text" : "muted"}>Mục tiêu {dmy(step.targetDate)}{late ? " · quá hạn" : ""}</small>
                {step.signerName && <small>{step.signerName}{step.actedAt ? ` · ${new Date(step.actedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</small>}
                {step.note && <small className="muted">“{step.note}”</small>}
              </div>
              <span className={`pill ${tone}`}>{label}</span>
              {step.canSign && (
                <span className="ap-actions">
                  <button type="button" className="button primary" onClick={() => void sign(step, true)}><Check className="ico" size={15} aria-hidden="true" /> Ký</button>
                  <button type="button" className="button danger" onClick={() => void sign(step, false)}><Undo2 className="ico" size={15} aria-hidden="true" /> Trả về</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Việc chờ tôi ký (PRC-S9): đơn hàng và ngân sách đang đến lượt người đăng nhập, quá hạn tô đỏ. */
export function MyApprovals(props: { store: PurchaseStore; refreshKey?: unknown; onOpenOrder: (id: string) => void; projectHref: (projectId: string) => string }) {
  const [items, setItems] = useState<PendingApproval[] | null>(null);
  useEffect(() => {
    let active = true;
    void props.store.myApprovals().then((list) => { if (active) setItems(list); }, () => { if (active) setItems([]); });
    return () => { active = false; };
  }, [props.store, props.refreshKey]);
  if (!items || !items.length) return null;
  const today = todayVN(systemClock);
  return (
    <section className="panel pj-section" aria-labelledby="ap-mine-title">
      <h2 id="ap-mine-title"><ClipboardSignature className="ico" size={18} aria-hidden="true" /> Chờ tôi ký <span className="pill warn">{items.length}</span></h2>
      <div className="table-scroll">
        <table className="pj-table">
          <thead><tr><th>Phiếu</th><th>Dự án</th><th>Ký với vai trò</th><th className="pj-num">Số tiền</th><th>Mục tiêu</th><th /></tr></thead>
          <tbody>{items.map((item) => (
            <tr key={item.stepId}>
              <td>{item.docType === "purchase" ? "Đơn đặt hàng" : "Ngân sách"}<br /><small className="muted">{item.title}</small></td>
              <td>{item.projectCode || "—"}</td>
              <td>{ROLE_LABELS[item.role]}</td>
              <td className="pj-num">{formatVnd(item.amount)}</td>
              <td className={item.targetDate < today ? "warn-text" : undefined}>{dmy(item.targetDate)}{item.targetDate < today ? " · quá hạn" : ""}</td>
              <td>{item.docType === "purchase"
                ? <button type="button" className="button" onClick={() => props.onOpenOrder(item.docId)}>Mở đơn</button>
                : item.projectId ? <a className="button" href={props.projectHref(item.projectId)}>Mở ngân sách</a> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
