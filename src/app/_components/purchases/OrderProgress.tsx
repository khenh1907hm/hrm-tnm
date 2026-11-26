"use client";
import { useEffect, useRef } from "react";
import { Check, CircleX } from "lucide-react";
import { orderPath, paymentTermsLabel, stageDepartmentLabel, type PathKey, type PathStep, type StageDepartments } from "../../../modules/purchases/flow";
import type { PurchaseOrder, PurchasePayment } from "../../../modules/purchases/types";

const deptOf = (departments: StageDepartments | undefined, step: PathStep) => step.stage && departments?.[step.stage] ? stageDepartmentLabel(departments[step.stage]) : "";

/**
 * Tiến trình một đơn mua hàng: thẻ "Đang ở bước" ở trên (bước mấy / tổng, ai phụ trách, việc cần làm)
 * và dải mũi tên nối nhau bên dưới, mỗi giai đoạn một khối. Chỉ hiện các bước đơn này đi qua theo điều kiện thanh toán.
 */
export function OrderProgress(props: { order: PurchaseOrder; payments: readonly PurchasePayment[]; departments?: StageDepartments | undefined; hint: string;
  /** Bước đang mở xem lịch sử / kết quả (bấm vào bước). */ selected?: PathKey | null; onSelect?: (key: PathKey) => void;
  /** Phiếu YCVT sinh ra đơn: hiện thành bước đầu (đã xong), bấm để mở danh sách YCVT. */ material?: { number: string; href: string } | null }) {
  const steps = orderPath(props.order, props.payments);
  const cancelled = props.order.status === "cancelled";
  const completed = props.order.status === "completed";
  const currentIndex = steps.findIndex((step) => step.state === "current");
  const current = currentIndex >= 0 ? steps[currentIndex]! : null;
  const done = steps.filter((step) => step.state === "done").length;
  const track = useRef<HTMLOListElement>(null);
  // Màn hẹp: cuộn để bước hiện tại nằm trong tầm nhìn
  useEffect(() => {
    const list = track.current;
    const node = list?.querySelector<HTMLElement>("[aria-current='step']");
    if (!list || !node) return;
    const offset = node.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    list.scrollLeft = Math.max(0, offset - list.clientWidth / 2 + node.clientWidth / 2);
  }, [currentIndex, steps.length]);
  const dept = current ? deptOf(props.departments, current) : "";

  return (
    <div className="op">
      <div className={`op-now${cancelled ? " is-bad" : completed ? " is-ok" : ""}`}>
        <div className="op-now-step" aria-hidden="true">
          {cancelled ? <CircleX size={22} /> : completed ? <Check size={22} /> : <><b>{currentIndex + 1}</b><small>/{steps.length}</small></>}
        </div>
        <div className="op-now-body">
          <span className="op-now-kicker">{cancelled ? "Đơn đã hủy" : completed ? "Hoàn tất" : `Bước ${currentIndex + 1}/${steps.length} · đã xong ${done}`}</span>
          <strong className="op-now-title">{cancelled ? "Đơn hàng đã hủy" : completed ? "Đơn hàng đã hoàn tất" : current?.label}</strong>
          {!cancelled && !completed && dept && <span className="op-now-dept">Phụ trách: {dept}</span>}
          <p className="op-now-hint">{props.hint}</p>
        </div>
        <span className="op-terms">{paymentTermsLabel(props.order)}</span>
      </div>
      <ol className={`op-track${props.onSelect ? " op-pickable" : ""}`} ref={track} aria-label="Các bước của đơn hàng (bấm một bước để xem lịch sử, kết quả)">
        {props.material && (
          <li className="op-step is-done" title={`Yêu cầu vật tư ${props.material.number}`}>
            <a className="op-nav-btn" href={props.material.href}>
              <span className="op-num" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
              <span className="op-text"><span className="op-label">Yêu cầu vật tư</span><small className="op-dept">{props.material.number}</small></span>
              <span className="sr-only"> (đã xong)</span>
            </a>
          </li>
        )}
        {steps.map((step, index) => {
          const stepDept = deptOf(props.departments, step);
          return (
            <li key={step.key} className={`op-step is-${cancelled && step.state !== "done" ? "todo" : step.state}${props.selected === step.key ? " is-picked" : ""}`} aria-current={step.state === "current" && !cancelled ? "step" : undefined}
              title={stepDept ? `${step.label} · ${stepDept}` : step.label}>
              {(() => {
                const inner = <>
                  <span className="op-num" aria-hidden="true">{step.state === "done" ? <Check size={13} strokeWidth={3} /> : index + (props.material ? 2 : 1)}</span>
                  <span className="op-text">
                    <span className="op-label">{step.label}</span>
                    {stepDept && <small className="op-dept">{stepDept}</small>}
                  </span>
                  <span className="sr-only">{step.state === "done" ? " (đã xong)" : step.state === "current" ? " (đang ở bước này)" : step.state === "skipped" ? " (không dùng)" : ""}</span>
                </>;
                return props.onSelect
                  ? <button type="button" className="op-nav-btn" aria-pressed={props.selected === step.key} onClick={() => props.onSelect?.(step.key)} title={`Xem lịch sử, kết quả bước “${step.label}”`}>{inner}</button>
                  : inner;
              })()}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Dải nhỏ ở danh sách đơn: mỗi bước một vạch, cùng số bước với thanh tiến trình của đơn. */
export function OrderMiniPath(props: { order: PurchaseOrder; payments: readonly PurchasePayment[] }) {
  const steps = orderPath(props.order, props.payments);
  const current = steps.find((step) => step.state === "current");
  const cancelled = props.order.status === "cancelled";
  const label = cancelled ? "Đã hủy" : props.order.status === "completed" ? "Hoàn tất" : current?.label ?? "";
  return (
    <div className={`op-mini${cancelled ? " is-bad" : ""}`}>
      <div className="op-mini-bar" role="img" aria-label={`${label}: ${steps.filter((step) => step.state === "done").length}/${steps.length} bước`}>
        {steps.map((step) => <span key={step.key} className={`is-${cancelled && step.state !== "done" ? "todo" : step.state}`} />)}
      </div>
      <small>{label}</small>
    </div>
  );
}
