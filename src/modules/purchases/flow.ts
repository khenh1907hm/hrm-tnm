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
  { key: "approved", label: "Duyệt" },
  { key: "po", label: "PO, NCC ký nhận" },
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
const STEP_RANK: Record<FlowStepKey, number> = { draft: 0, submitted: 1, approved: 2, po: 2.5, advance: 3, ordered: 4, prepayment: 5, received: 6, final: 7, completed: 8 };

/**
 * PUR-03: trạng thái từng bước. Bước thanh toán (tạm ứng, trước, còn lại) là tùy chọn: xong khi có khoản đã chi,
 * đang làm khi có khoản chờ duyệt hoặc chờ chi, bỏ qua khi đơn đã qua bước đó mà không có khoản nào.
 */
export function stepStates(order: Pick<PurchaseOrder, "status"> & Partial<Pick<PurchaseOrder, "advanceRequired" | "prepayRequired" | "usesChain" | "poIssuedAt" | "supplierAcceptedAt">>, payments: readonly Pick<PurchasePayment, "kind" | "status">[]): Record<FlowStepKey, StepState> {
  const rank = ORDER_RANK[order.status];
  const states = {} as Record<FlowStepKey, StepState>;
  // PRC-30: NCC không cần tạm ứng / thanh toán trước thì bước đó "Không dùng" ngay từ đầu
  const notNeeded = (key: FlowStepKey) => (key === "advance" && order.advanceRequired === false) || (key === "prepayment" && order.prepayRequired === false);
  for (const step of FLOW_STEPS) {
    const stepRank = STEP_RANK[step.key];
    // PRC-34: bước PO chỉ có ở đơn dự án (đi chuỗi ký)
    if (step.key === "po") {
      if (!order.usesChain) states.po = "skipped";
      else if (order.status === "cancelled") states.po = "todo";
      else if (order.supplierAcceptedAt || rank > ORDER_RANK.approved) states.po = "done";
      else states.po = order.status === "approved" ? "current" : "todo";
      continue;
    }
    if (step.key === "advance" || step.key === "prepayment" || step.key === "final") {
      const mine = payments.filter((payment) => payment.kind === step.key && payment.status !== "rejected");
      if (mine.some((payment) => payment.status === "requested" || payment.status === "approved")) states[step.key] = "current";
      else if (mine.some((payment) => payment.status === "paid")) states[step.key] = "done";
      else if (notNeeded(step.key)) states[step.key] = "skipped";
      else if (step.key === "advance" && order.advanceRequired && rank >= ORDER_RANK.approved && order.status !== "cancelled") states[step.key] = poBlock(order) ? "todo" : "current";
      else states[step.key] = rank > stepRank || order.status === "completed" ? "skipped" : "todo";
      continue;
    }
    if (order.status === "cancelled") { states[step.key] = "todo"; continue; }
    // Đơn dự án: đã phát hành PO thì bước Duyệt đã xong, bước PO là bước hiện tại
    if (step.key === "approved" && order.usesChain && order.poIssuedAt) { states.approved = "done"; continue; }
    states[step.key] = rank > stepRank || order.status === "completed" ? "done" : rank === stepRank ? "current" : "todo";
  }
  return states;
}

export type PurchaseAction =
  | "edit" | "submit" | "approve" | "reject" | "order" | "track" | "requestAdvance" | "requestPrepayment" | "requestFinal"
  | "receive" | "complete" | "cancel" | "decidePayment" | "pay" | "issuePo" | "supplierAccept";

/**
 * PUR-04: hành động được phép theo trạng thái đơn và vai trò (giống các hàm purchase_* ở Supabase).
 * Người lập: sửa và lập đơn khi nháp / bị từ chối; đặt hàng, đề nghị chi, nhận hàng, hoàn tất. Sếp: duyệt đơn, duyệt khoản chi,
 * và làm được mọi việc của người lập trừ sửa đơn. Kế toán (payer): chi khoản đã duyệt. Hủy: người lập trước khi đặt hàng, sếp hoặc Admin khi chưa xong.
 */
export function allowedActions(order: Pick<PurchaseOrder, "status" | "requesterId"> & Partial<Pick<PurchaseOrder, "usesChain" | "advanceRequired" | "prepayRequired" | "poIssuedAt" | "supplierAcceptedAt">>, me: { userId: string; isAdmin: boolean; isProjectLead?: boolean; isAdminOffice?: boolean } & PurchaseRoles, payments: readonly (Pick<PurchasePayment, "status"> & Partial<Pick<PurchasePayment, "kind" | "usesChain">>)[] = []): Set<PurchaseAction> {
  const actions = new Set<PurchaseAction>();
  const mine = order.requesterId === me.userId;
  const handler = mine || me.isApprover || me.isAdmin;
  const status = order.status;
  if (mine && (status === "draft" || status === "rejected")) { actions.add("edit"); actions.add("submit"); }
  if (me.isApprover && status === "submitted" && !order.usesChain) { actions.add("approve"); actions.add("reject"); }
  // PRC-31: NCC cần tạm ứng thì phải chi xong tạm ứng mới sang Đặt hàng, theo dõi
  if (handler && status === "approved" && !orderBlock(order, payments)) actions.add("order");
  // PRC-34: Hành chánh phát hành PO, rồi ghi nhận NCC ký nhận
  if (order.usesChain && status === "approved" && !order.poIssuedAt && (me.isAdminOffice || me.isAdmin)) actions.add("issuePo");
  if (order.usesChain && status === "approved" && order.poIssuedAt && !order.supplierAcceptedAt && (handler || me.isAdminOffice)) actions.add("supplierAccept");
  if (status === "approved" || status === "ordered" || status === "received") {
    actions.add("track");
    if (handler || me.isPayer) {
      // Đơn đi quy trình mới: chỉ mở loại khoản NCC cần (đơn cũ giữ như trước)
      const terms = order.advanceRequired !== undefined;
      if ((!terms || order.advanceRequired) && !poBlock(order)) actions.add("requestAdvance");
      if (!terms || order.prepayRequired) actions.add("requestPrepayment");
      if (status !== "approved") actions.add("requestFinal");
    }
  }
  if ((handler || me.isProjectLead) && (status === "ordered" || status === "received")) actions.add("receive");
  if (handler && status === "received" && !payments.some((payment) => payment.status === "requested" || payment.status === "approved")) actions.add("complete");
  if (status !== "completed" && status !== "cancelled" && ((mine && ["draft", "submitted", "rejected", "approved"].includes(status)) || me.isApprover || me.isAdmin)) actions.add("cancel");
  if (me.isApprover && payments.some((payment) => payment.status === "requested" && !payment.usesChain)) actions.add("decidePayment");
  if (me.isPayer && payments.some((payment) => payment.status === "approved")) actions.add("pay");
  return actions;
}

/** PRC-34: đơn dự án phải được phát hành PO và NCC ký nhận rồi mới tạm ứng / đặt hàng (PO chỉ hiệu lực khi NCC ký). */
export function poBlock(order: Partial<Pick<PurchaseOrder, "usesChain" | "poIssuedAt" | "supplierAcceptedAt">>): string | null {
  if (!order.usesChain) return null;
  if (!order.poIssuedAt) return "PO_NOT_ISSUED";
  return order.supplierAcceptedAt ? null : "PO_NOT_ACCEPTED";
}

/** PRC-31: lý do chưa được Đặt hàng (PO chưa hiệu lực, hoặc NCC cần tạm ứng mà tạm ứng chưa chi xong), hoặc null. */
export function orderBlock(order: Partial<Pick<PurchaseOrder, "advanceRequired" | "usesChain" | "poIssuedAt" | "supplierAcceptedAt">>, payments: readonly (Pick<PurchasePayment, "status"> & Partial<Pick<PurchasePayment, "kind">>)[]): string | null {
  const po = poBlock(order);
  if (po) return po;
  if (!order.advanceRequired) return null;
  return payments.some((payment) => payment.kind === "advance" && payment.status === "paid") ? null : "PO_ADVANCE_NOT_PAID";
}

/** PRC-32: kiểm tra một đề nghị trước khi gửi: số tiền > 0, thuế không âm, có số hóa đơn (tạm ứng thì "tạm ứng"), tổng trước thuế không vượt giá trị đơn. */
export function paymentIssue(order: Pick<PurchaseOrder, "totalEstimate" | "totalActual">, payments: readonly Pick<PurchasePayment, "amount" | "status">[], input: { kind: PaymentKind; amount: number; vatAmount: number; invoiceNo: string }): string | null {
  if (!(input.amount > 0) || !Number.isInteger(input.amount)) return "PO_BAD_AMOUNT";
  if (!(input.vatAmount >= 0) || !Number.isInteger(input.vatAmount)) return "PO_BAD_AMOUNT";
  if (input.kind !== "advance" && input.invoiceNo.trim().length < 1) return "PO_INVOICE_REQUIRED";
  const used = payments.filter((payment) => payment.status !== "rejected").reduce((sum, payment) => sum + payment.amount, 0);
  if (used + input.amount > (order.totalActual ?? order.totalEstimate)) return "PO_PAY_OVER";
  return null;
}

/** PUR-05: tổng tiền theo loại khoản chi đã chi, và số còn phải trả nhà cung cấp so với tiền thực nhận (tạm ứng tính vào đã trả). */
export function paymentSummary(order: Pick<PurchaseOrder, "totalEstimate" | "totalActual">, payments: readonly Pick<PurchasePayment, "kind" | "amount" | "status">[]) {
  const paid = (kind?: PaymentKind) => payments.filter((payment) => payment.status === "paid" && (!kind || payment.kind === kind)).reduce((sum, payment) => sum + payment.amount, 0);
  const pending = payments.filter((payment) => payment.status === "requested" || payment.status === "approved").reduce((sum, payment) => sum + payment.amount, 0);
  const basis = order.totalActual ?? order.totalEstimate;
  return { advance: paid("advance"), prepayment: paid("prepayment"), final: paid("final"), paid: paid(), pending, remaining: basis - paid() };
}

export const EVENT_LABELS: Record<string, string> = {
  create: "Lập đơn từ phiếu yêu cầu vật tư", submit: "Lập đơn, gửi duyệt", approve: "Duyệt đơn", reject: "Trả về / từ chối đơn",
  issue_po: "Hành chánh phát hành PO", supplier_accept: "NCC ký xác nhận PO",
  "payment_sign:pic": "Phụ trách ký đề nghị thanh toán", "payment_sign:technical": "P. Kỹ thuật ký đề nghị thanh toán", "payment_sign:material": "P. Vật tư ký đề nghị thanh toán",
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
export function nextHint(order: Pick<PurchaseOrder, "status" | "requesterId"> & Partial<Pick<PurchaseOrder, "advanceRequired" | "prepayRequired" | "usesChain" | "poIssuedAt" | "supplierAcceptedAt">>, me: { userId: string } & PurchaseRoles, payments: readonly (Pick<PurchasePayment, "status"> & Partial<Pick<PurchasePayment, "kind">>)[]): string {
  const mine = order.requesterId === me.userId;
  if (me.isApprover && order.status === "submitted") return "Bạn là người duyệt: xem hàng cần mua rồi bấm Duyệt đơn hoặc Từ chối.";
  if (me.isApprover && payments.some((payment) => payment.status === "requested")) return "Có khoản tạm ứng / thanh toán đang chờ duyệt ở mục Tạm ứng và thanh toán.";
  if (me.isPayer && payments.some((payment) => payment.status === "approved")) return "Có khoản đã được sếp duyệt chờ bạn Thực hiện chi.";
  switch (order.status) {
    case "draft": return mine ? "Kiểm tra lại hàng cần mua rồi bấm Lập đơn, gửi duyệt." : "Đơn đang được soạn.";
    case "rejected": return mine ? "Sếp đã trả về: sửa theo góp ý rồi lập lại." : "Sếp đã trả về cho người lập sửa.";
    case "submitted": return "Đang chờ sếp duyệt.";
    case "approved": return order.usesChain && !order.poIssuedAt
      ? "Đã duyệt. Hành chánh phát hành PO chính thức (P-CC-08) gửi nhà cung cấp."
      : order.usesChain && !order.supplierAcceptedAt
        ? "PO đã phát hành. Khi NCC ký bản sao PO gửi lại, bấm NCC đã ký xác nhận PO."
        : "advanceRequired" in order && order.advanceRequired
      ? orderBlock(order, payments)
        ? "Đã duyệt. NCC cần tạm ứng: lập Đề nghị tạm ứng, ký duyệt xong và kế toán chi rồi mới Đặt hàng, theo dõi."
        : "Tạm ứng đã chi. Bấm Đặt hàng để chuyển sang theo dõi đơn hàng."
      : "Đã duyệt. NCC không cần tạm ứng: bấm Đặt hàng để chuyển sang theo dõi đơn hàng.";
    case "ordered": return "prepayRequired" in order && order.prepayRequired
      ? "Đang theo dõi. NCC cần thanh toán trước: lập Đề nghị thanh toán trước (kèm hóa đơn). Hàng về thì bấm Nhận hàng, kiểm tra."
      : "Đang chờ giao hàng: cập nhật theo dõi khi có tin; hàng về thì bấm Nhận hàng, kiểm tra.";
    case "received": return "Đã nhận hàng. Đề nghị thanh toán phần còn lại (nếu còn), chi xong thì bấm Hoàn tất đơn.";
    case "completed": return "Đơn đã hoàn tất.";
    default: return "Đơn đã hủy.";
  }
}
