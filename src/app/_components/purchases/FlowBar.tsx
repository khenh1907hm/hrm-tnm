"use client";
import { ArrowRight, Check, CircleCheck, CreditCard, FilePen, HandCoins, PackageCheck, Send, ShieldCheck, Truck, Wallet, type LucideIcon } from "lucide-react";
import { FLOW_STEPS, progressOf, type FlowStepKey, type StepState } from "../../../modules/purchases/flow";
import type { PurchaseStatus } from "../../../modules/purchases/types";

export const STEP_ICONS: Record<FlowStepKey, LucideIcon> = {
  draft: FilePen, submitted: Send, approved: ShieldCheck, advance: HandCoins, ordered: Truck, prepayment: CreditCard, received: PackageCheck, final: Wallet, completed: CircleCheck,
};
const OPTIONAL = new Set<FlowStepKey>(["advance", "prepayment", "final"]);
const STATE_TEXT: Record<StepState, string> = { done: "Đã xong", current: "Đang ở bước này", todo: "Chưa tới", skipped: "Không dùng" };

/** Thanh tiến trình lớn của một đơn: biểu tượng từng bước, đường nối tô màu theo tiến độ, bước tùy chọn có nét đứt. */
export function FlowStepper(props: { states: Record<FlowStepKey, StepState>; hint: string; cancelled: boolean }) {
  const doneCount = FLOW_STEPS.filter((step) => props.states[step.key] === "done" || props.states[step.key] === "skipped").length;
  const percent = Math.round((doneCount / (FLOW_STEPS.length - 1)) * 100);
  return (
    <div className="po-flow-card">
      <div className="po-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} aria-label="Tiến độ đơn hàng">
        <span style={{ width: `${props.cancelled ? 0 : Math.min(100, percent)}%` }} />
      </div>
      <ol className="po-steps">
        {FLOW_STEPS.map((step) => {
          const state = props.states[step.key];
          const Icon = state === "done" ? Check : STEP_ICONS[step.key];
          return (
            <li key={step.key} className={`${state}${OPTIONAL.has(step.key) ? " optional" : ""}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="dot" aria-hidden="true"><Icon size={16} /></span>
              <span className="po-step-label">{step.label}</span>
              <small className="po-step-state">{OPTIONAL.has(step.key) && state === "todo" ? "Tùy chọn" : STATE_TEXT[state]}</small>
            </li>
          );
        })}
      </ol>
      <p className="po-hint">{props.hint}</p>
    </div>
  );
}

/** Sơ đồ quy trình rút gọn ở đầu trang Đặt hàng. */
export function FlowLegend() {
  return (
    <ol className="po-flow" aria-label="Quy trình đặt hàng">
      {FLOW_STEPS.map((step, index) => {
        const Icon = STEP_ICONS[step.key];
        return (
          <li key={step.key} className={OPTIONAL.has(step.key) ? "optional" : ""}>
            <span className="po-flow-chip"><Icon size={15} aria-hidden="true" /> {step.label}{OPTIONAL.has(step.key) ? " (nếu cần)" : ""}</span>
            {index < FLOW_STEPS.length - 1 && <ArrowRight size={14} className="po-flow-arrow" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Thanh tiến độ nhỏ cho từng dòng ở danh sách đơn. */
export function MiniProgress({ status }: { status: PurchaseStatus }) {
  const { percent, label } = progressOf(status);
  return (
    <div className={`po-mini ${status === "cancelled" ? "cancelled" : status === "rejected" ? "rejected" : status === "completed" ? "done" : ""}`}>
      <div className="po-progress small" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}><span style={{ width: `${percent}%` }} /></div>
      <small>{label}</small>
    </div>
  );
}
