import type { PaymentKind, PurchaseItem, PurchaseOrder, PurchasePayment, PurchaseRoles, PurchaseStatus } from "./types";

/** PUR-01: thành tiền một dòng (làm tròn đến đồng) và tổng dự kiến / thực nhận của đơn. */
export const lineTotal = (item: Pick<PurchaseItem, "quantity" | "unitPrice">) => Math.round(item.quantity * item.unitPrice);
export const estimateTotal = (items: readonly Pick<PurchaseItem, "quantity" | "unitPrice">[]) => items.reduce((sum, item) => sum + lineTotal(item), 0);
export const actualTotal = (items: readonly Pick<PurchaseItem, "acceptedQty" | "unitPrice">[]) => items.reduce((sum, item) => sum + Math.round(item.acceptedQty * item.unitPrice), 0);

/** PUR-02: kiểm tra đơn trước khi lưu / lập đơn. Trả về mã lỗi đầu tiên hoặc null. */
export function draftIssue(draft: { kind: string; projectId: string | null; title: string; items: readonly Pick<PurchaseItem, "name" | "quantity" | "unitPrice">[] }, submitting: boolean): string | null {
  if (!draft.title.trim()) return "PO_TITLE_REQUIRED";
  if (draft.kind === "project" && !draft.projectId) return "PO_PROJECT_REQUIRED";
  if (draft.items.some((item) => !item.name.trim() || !(item.quantity > 0) || !(item.unitPrice >= 0) || !Number.isFinite(item.unitPrice))) return "PO_ITEM_INVALID";
  if (submitting && !draft.items.length) return "PO_NO_ITEMS";
  return null;
}

/** Các bước hiển thị trên thanh tiến trình (theo quy trình người dùng mô tả). */
export const FLOW_STEPS = [
  { key: "draft", label: "Đơn nháp" },
  { key: "submitted", label: "Lập đơn, chờ duyệt" },
  { key: "approved", label: "Sếp duyệt" },
  { key: "advance", label: "Tạm ứng" },
  { key: "ordered", label: "Đặt hàng, theo dõi" },
  { key: "prepayment", label: "Thanh toán trước" },
  { key: "received", label: "Nhận hàng, kiểm tra" },
  { key: "final", label: "Thanh toán còn lại" },
  { key: "completed", label: "Hoàn tất" },
] as const;
export type FlowStepKey = typeof FLOW_STEPS[number]["key"];
export type StepState = "done" | "current" | "todo" | "skipped";

const ORDER_RANK: Record<PurchaseStatus, number> = { draft: 0, rejected: 0, submitted: 1, approved: 2, ordered: 4, received: 6, completed: 8, cancelled: -1 };
const STEP_RANK: Record<FlowStepKey, number> = { draft: 0, submitted: 1, approved: 2, advance: 3, ordered: 4, prepayment: 5, received: 6, final: 7, completed: 8 };

/**
 * PUR-03: trạng thái từng bước. Bước thanh toán (tạm ứng, trước, còn lại) là tùy chọn: xong khi có khoản đã chi,
 * đang làm khi có khoản chờ duyệt hoặc chờ chi, bỏ qua khi đơn đã qua bước đó mà không có khoản nào.
 */
export function stepStates(order: Pick<PurchaseOrder, "status">, payments: readonly Pick<PurchasePayment, "kind" | "status">[]): Record<FlowStepKey, StepState> {
  const rank = ORDER_RANK[order.status];
  const states = {} as Record<FlowStepKey, StepState>;
  for (const step of FLOW_STEPS) {
    const stepRank = STEP_RANK[step.key];
    if (step.key === "advance" || step.key === "prepayment" || step.key === "final") {
      const mine = payments.filter((payment) => payment.kind === step.key && payment.status !== "rejected");
      if (mine.some((payment) => payment.status === "requested" || payment.status === "approved")) states[step.key] = "current";
      else if (mine.some((payment) => payment.status === "paid")) states[step.key] = "done";
      else states[step.key] = rank > stepRank || order.status === "completed" ? "skipped" : "todo";
      continue;
    }
    if (order.status === "cancelled") { states[step.key] = "todo"; continue; }
    states[step.key] = rank > stepRank || order.status === "completed" ? "done" : rank === stepRank ? "current" : "todo";
  }
  return states;
}

export type PurchaseAction =
  | "edit" | "submit" | "approve" | "reject" | "order" | "track" | "requestAdvance" | "requestPrepayment" | "requestFinal"
  | "receive" | "complete" | "cancel" | "decidePayment" | "pay";

/**
 * PUR-04: hành động được phép theo trạng thái đơn và vai trò (giống các hàm purchase_* ở Supabase).
 * Người lập: sửa và lập đơn khi nháp / bị từ chối; đặt hàng, đề nghị chi, nhận hàng, hoàn tất. Sếp: duyệt đơn, duyệt khoản chi,
 * và làm được mọi việc của người lập trừ sửa đơn. Kế toán (payer): chi khoản đã duyệt. Hủy: người lập trước khi đặt hàng, sếp hoặc Admin khi chưa xong.
 */
export function allowedActions(order: Pick<PurchaseOrder, "status" | "requesterId"> & { usesChain?: boolean }, me: { userId: string; isAdmin: boolean; isProjectLead?: boolean } & PurchaseRoles, payments: readonly Pick<PurchasePayment, "status">[] = []): Set<PurchaseAction> {
  const actions = new Set<PurchaseAction>();
  const mine = order.requesterId === me.userId;
  const handler = mine || me.isApprover || me.isAdmin;
  const status = order.status;
  if (mine && (status === "draft" || status === "rejected")) { actions.add("edit"); actions.add("submit"); }
  if (me.isApprover && status === "submitted" && !order.usesChain) { actions.add("approve"); actions.add("reject"); }
  if (handler && status === "approved") actions.add("order");
  if (status === "approved" || status === "ordered" || status === "received") {
    actions.add("track");
    if (handler || me.isPayer) { actions.add("requestAdvance"); actions.add("requestPrepayment"); if (status !== "approved") actions.add("requestFinal"); }
  }
  if ((handler || me.isProjectLead) && (status === "ordered" || status === "received")) actions.add("receive");
  if (handler && status === "received" && !payments.some((payment) => payment.status === "requested" || payment.status === "approved")) actions.add("complete");
  if (status !== "completed" && status !== "cancelled" && ((mine && ["draft", "submitted", "rejected", "approved"].includes(status)) || me.isApprover || me.isAdmin)) actions.add("cancel");
  if (me.isApprover && payments.some((payment) => payment.status === "requested")) actions.add("decidePayment");
  if (me.isPayer && payments.some((payment) => payment.status === "approved")) actions.add("pay");
  return actions;
}

/** PUR-05: tổng tiền theo loại khoản chi đã chi, và số còn phải trả nhà cung cấp so với tiền thực nhận (tạm ứng tính vào đã trả). */
export function paymentSummary(order: Pick<PurchaseOrder, "totalEstimate" | "totalActual">, payments: readonly Pick<PurchasePayment, "kind" | "amount" | "status">[]) {
  const paid = (kind?: PaymentKind) => payments.filter((payment) => payment.status === "paid" && (!kind || payment.kind === kind)).reduce((sum, payment) => sum + payment.amount, 0);
  const pending = payments.filter((payment) => payment.status === "requested" || payment.status === "approved").reduce((sum, payment) => sum + payment.amount, 0);
  const basis = order.totalActual ?? order.totalEstimate;
  return { advance: paid("advance"), prepayment: paid("prepayment"), final: paid("final"), paid: paid(), pending, remaining: basis - paid() };
}

export const EVENT_LABELS: Record<string, string> = {
  submit: "Lập đơn, gửi duyệt", approve: "Duyệt đơn", reject: "Trả về / từ chối đơn",
  "sign:pic": "Phụ trách ký", "sign:technical": "P. Kỹ thuật ký", "sign:material": "P. Vật tư ký", "sign:accounting": "Kế toán ký", "sign:leader": "Lãnh đạo ký", "sign:admin_office": "Hành chánh ký nhận", order: "Đặt hàng", track: "Cập nhật theo dõi",
  receive: "Nhận hàng, kiểm tra", complete: "Hoàn tất đơn", cancel: "Hủy đơn",
  "payment_request:advance": "Đề nghị tạm ứng", "payment_request:prepayment": "Đề nghị thanh toán trước", "payment_request:final": "Đề nghị thanh toán còn lại",
  "payment_approve:advance": "Sếp duyệt tạm ứng", "payment_approve:prepayment": "Sếp duyệt thanh toán trước", "payment_approve:final": "Sếp duyệt thanh toán còn lại",
  "payment_reject:advance": "Sếp từ chối tạm ứng", "payment_reject:prepayment": "Sếp từ chối thanh toán trước", "payment_reject:final": "Sếp từ chối thanh toán còn lại",
  "paid:advance": "Đã chi tạm ứng", "paid:prepayment": "Đã chi thanh toán trước", "paid:final": "Đã chi thanh toán còn lại",
};

/** PUR-03: phần trăm tiến độ và tên bước hiện tại của đơn (cho thanh tiến độ ở danh sách). */
export function progressOf(status: PurchaseStatus): { percent: number; label: string } {
  const map: Record<PurchaseStatus, [number, string]> = {
    draft: [5, "Đang soạn nháp"], rejected: [5, "Sếp trả về, cần sửa"], submitted: [20, "Chờ sếp duyệt"], approved: [35, "Đã duyệt, chờ đặt hàng"],
    ordered: [60, "Đang theo dõi giao hàng"], received: [85, "Đã nhận, chờ thanh toán / hoàn tất"], completed: [100, "Hoàn tất"], cancelled: [0, "Đã hủy"],
  };
  const [percent, label] = map[status];
  return { percent, label };
}

/** Gợi ý việc tiếp theo cho người đang xem (hiện dưới thanh tiến trình). */
export function nextHint(order: Pick<PurchaseOrder, "status" | "requesterId">, me: { userId: string } & PurchaseRoles, payments: readonly Pick<PurchasePayment, "status">[]): string {
  const mine = order.requesterId === me.userId;
  if (me.isApprover && order.status === "submitted") return "Bạn là người duyệt: xem hàng cần mua rồi bấm Duyệt đơn hoặc Từ chối.";
  if (me.isApprover && payments.some((payment) => payment.status === "requested")) return "Có khoản tạm ứng / thanh toán chờ bạn duyệt ở mục Tạm ứng và thanh toán.";
  if (me.isPayer && payments.some((payment) => payment.status === "approved")) return "Có khoản đã được sếp duyệt chờ bạn Thực hiện chi.";
  switch (order.status) {
    case "draft": return mine ? "Kiểm tra lại hàng cần mua rồi bấm Lập đơn, gửi duyệt." : "Đơn đang được soạn.";
    case "rejected": return mine ? "Sếp đã trả về: sửa theo góp ý rồi lập lại." : "Sếp đã trả về cho người lập sửa.";
    case "submitted": return "Đang chờ sếp duyệt.";
    case "approved": return "Đã duyệt. Nếu cần tiền mua thì Đề nghị tạm ứng; sau đó bấm Đặt hàng khi đã chốt nhà cung cấp.";
    case "ordered": return "Đang chờ giao hàng: cập nhật theo dõi khi có tin; hàng về thì bấm Nhận hàng, kiểm tra.";
    case "received": return "Đã nhận hàng. Đề nghị thanh toán phần còn lại (nếu còn), chi xong thì bấm Hoàn tất đơn.";
    case "completed": return "Đơn đã hoàn tất.";
    default: return "Đơn đã hủy.";
  }
}
