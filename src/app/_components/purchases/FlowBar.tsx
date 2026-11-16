"use client";
import { ArrowRight, Banknote, Check, CircleCheck, CircleX, CreditCard, FilePen, FileSignature, FolderCheck, HandCoins, PackageCheck, Send, ShieldCheck, Truck, Wallet, Warehouse, type LucideIcon } from "lucide-react";
import { FLOW_STEPS, progressOf, stageDepartmentLabel, type FlowStepKey, type StageDepartments, type StepState } from "../../../modules/purchases/flow";
import type { PurchaseOrder, PurchaseStatus } from "../../../modules/purchases/types";

export const STEP_ICONS: Record<FlowStepKey, LucideIcon> = {
  draft: FilePen, submitted: Send, approved: ShieldCheck, po: FileSignature, advance: HandCoins, advance_pay: Banknote, ordered: Truck,
  prepayment: CreditCard, prepayment_pay: Banknote, received: PackageCheck, stocked: Warehouse, final: FolderCheck, final_pay: Wallet,
  completed: CircleCheck, failed: CircleX,
};
const OPTIONAL = new Set<FlowStepKey>(["advance", "advance_pay", "prepayment", "prepayment_pay", "final_pay"]);
const STATE_TEXT: Record<StepState, string> = { done: "Đã xong", current: "Đang ở bước này", todo: "Chưa tới", skipped: "Không dùng" };
const deptOf = (departments: StageDepartments | undefined, key: FlowStepKey) =>
  departments && key !== "completed" && key !== "failed" && departments[key] ? stageDepartmentLabel(departments[key]) : "";

/** Danh sách giai đoạn của một đơn (như màn hình quy trình mua hàng): biểu tượng, tên giai đoạn, phòng ban phụ trách, trạng thái. */
export function FlowStepper(props: { states: Record<FlowStepKey, StepState>; hint: string; cancelled: boolean; departments?: StageDepartments | undefined }) {
  const counted = FLOW_STEPS.filter((step) => step.key !== "failed");
  const doneCount = counted.filter((step) => props.states[step.key] === "done" || props.states[step.key] === "skipped").length;
  const percent = Math.round((doneCount / counted.length) * 100);
  return (
    <div className="po-flow-card">
      <div className="po-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} aria-label="Tiến độ đơn hàng">
        <span style={{ width: `${props.cancelled ? 0 : Math.min(100, percent)}%` }} />
      </div>
      <ol className="po-stages">
        {FLOW_STEPS.map((step) => {
          const state = props.states[step.key];
          const Icon = state === "done" ? Check : STEP_ICONS[step.key];
          const dept = deptOf(props.departments, step.key);
          return (
            <li key={step.key} className={`${state}${OPTIONAL.has(step.key) ? " optional" : ""}${step.key === "failed" ? " failed" : ""}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="dot" aria-hidden="true"><Icon size={14} /></span>
              <span className="po-stage-label">{step.label}</span>
              {dept && <span className="po-stage-dept">{dept}</span>}
              <small className="po-stage-state">{OPTIONAL.has(step.key) && state === "todo" ? "Nếu cần" : STATE_TEXT[state]}</small>
            </li>
          );
        })}
      </ol>
      <p className="po-hint">{props.hint}</p>
    </div>
  );
}

/** Sơ đồ quy trình rút gọn ở đầu trang Đặt hàng (kèm phòng ban phụ trách nếu có). */
export function FlowLegend(props: { departments?: StageDepartments | undefined }) {
  return (
    <ol className="po-flow" aria-label="Quy trình đặt hàng">
      {FLOW_STEPS.map((step, index) => {
        const Icon = STEP_ICONS[step.key];
        const dept = deptOf(props.departments, step.key);
        return (
          <li key={step.key} className={OPTIONAL.has(step.key) ? "optional" : ""}>
            <span className="po-flow-chip"><Icon size={15} aria-hidden="true" /> {step.label}{OPTIONAL.has(step.key) ? " (nếu cần)" : ""}{dept ? <small className="po-flow-dept"> · {dept}</small> : null}</span>
            {index < FLOW_STEPS.length - 1 && <ArrowRight size={14} className="po-flow-arrow" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Thanh tiến độ nhỏ cho từng dòng ở danh sách đơn. */
export function MiniProgress({ status, order }: { status: PurchaseStatus; order?: Pick<PurchaseOrder, "stockedAt" | "docsCollectedAt"> }) {
  const { percent, label } = progressOf(status, order);
  return (
    <div className={`po-mini ${status === "cancelled" ? "cancelled" : status === "rejected" ? "rejected" : status === "completed" ? "done" : ""}`}>
      <div className="po-progress small" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}><span style={{ width: `${percent}%` }} /></div>
      <small>{label}</small>
    </div>
  );
}
