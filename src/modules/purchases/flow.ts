import { ROLE_LABELS, type Department } from "./approval";
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

/**
 * Các giai đoạn hiển thị trên thanh tiến trình (theo quy trình mua hàng của công ty):
 * Đơn hàng nháp → Lập đơn hàng → Duyệt → PO → Tạm ứng → Thực hiện chi tạm ứng → Theo dõi đơn hàng → Thanh toán trước nhận hàng
 * → Thực hiện chi TT trước → Nhận hàng, kiểm đếm → Nhập kho → Thu thập chứng từ & thanh toán → Thực hiện chi TT sau nhận hàng → Thành công / Thất bại.
 */
export const FLOW_STEPS = [
  { key: "draft", label: "Đơn hàng nháp" },
  { key: "submitted", label: "Lập đơn hàng" },
  { key: "approved", label: "Duyệt" },
  { key: "po", label: "PO, NCC ký nhận" },
  { key: "advance", label: "Yêu cầu tạm ứng (RFP)" },
  { key: "advance_pay", label: "Thực hiện chi tạm ứng" },
  { key: "ordered", label: "Theo dõi đơn hàng" },
  { key: "prepayment", label: "Yêu cầu thanh toán trước nhận hàng (RFP)" },
  { key: "prepayment_pay", label: "Thực hiện chi TT trước nhận hàng" },
  { key: "received", label: "Nhận hàng, kiểm đếm" },
  { key: "stocked", label: "Nhập kho" },
  { key: "final", label: "Thu thập chứng từ & yêu cầu thanh toán (RFP)" },
  { key: "final_pay", label: "Thực hiện chi TT sau nhận hàng" },
  { key: "completed", label: "Thành công" },
  { key: "failed", label: "Thất bại" },
] as const;
export type FlowStepKey = typeof FLOW_STEPS[number]["key"];
export type StepState = "done" | "current" | "todo" | "skipped";

/** Giai đoạn giao được cho phòng ban (trừ hai kết quả cuối). */
export type AssignableStage = Exclude<FlowStepKey, "completed" | "failed">;
export const ASSIGNABLE_STAGES = FLOW_STEPS.map((step) => step.key).filter((key): key is AssignableStage => key !== "completed" && key !== "failed");
/** Phòng ban phụ trách một giai đoạn: "pic" = người lập / phụ trách dự án, "" = không giao. */
export type StageDepartment = "" | "pic" | Department;
export type StageDepartments = Record<AssignableStage, StageDepartment>;
export const STAGE_DEPARTMENT_DEFAULTS: StageDepartments = {
  // Người lập / phụ trách nắm đơn từ nháp tới PO, theo dõi, chứng từ; chỉ nhận hàng, nhập kho giao cho Kho
  draft: "pic", submitted: "pic", approved: "leader", po: "pic", advance: "pic", advance_pay: "accounting", ordered: "pic",
  prepayment: "pic", prepayment_pay: "accounting", received: "warehouse", stocked: "warehouse", final: "pic", final_pay: "accounting",
};
export const STAGE_DEPARTMENT_OPTIONS: readonly StageDepartment[] = ["pic", "technical", "material", "warehouse", "accounting", "leader", ""];
export const stageDepartmentLabel = (value: StageDepartment) => value === "" ? "Không giao" : value === "pic" ? "Người lập / Phụ trách" : ROLE_LABELS[value];
/** Gộp cấu hình đã lưu với mặc định (bỏ giá trị lạ). */
export function mergeStageDepartments(saved: Partial<Record<string, string>> | null | undefined): StageDepartments {
  const out = { ...STAGE_DEPARTMENT_DEFAULTS };
  for (const key of ASSIGNABLE_STAGES) {
    const value = saved?.[key];
    if (value !== undefined && (STAGE_DEPARTMENT_OPTIONS as readonly string[]).includes(value)) out[key] = value as StageDepartment;
  }
  return out;
}
/** Giai đoạn chỉ người lập / sếp / phòng ban được giao (và Admin) bấm được: nhận hàng, nhập kho, thu thập chứng từ. */
export type EnforcedStage = "received" | "stocked" | "final";

const ORDER_RANK: Record<PurchaseStatus, number> = { draft: 0, rejected: 0, submitted: 1, approved: 2, ordered: 4, received: 6, completed: 8, cancelled: -1 };
const STEP_RANK: Record<FlowStepKey, number> = {
  draft: 0, submitted: 1, approved: 2, po: 2.5, advance: 3, advance_pay: 3.5, ordered: 4, prepayment: 5, prepayment_pay: 5.5,
  received: 6, stocked: 6.5, final: 7, final_pay: 7.5, completed: 8, failed: 9,
};
const PAY_STEPS: Partial<Record<FlowStepKey, PaymentKind>> = { advance_pay: "advance", prepayment_pay: "prepayment", final_pay: "final" };

type StepOrder = Pick<PurchaseOrder, "status"> & Partial<Pick<PurchaseOrder, "advanceRequired" | "prepayRequired" | "usesChain" | "poIssuedAt" | "supplierAcceptedAt" | "stockedAt" | "docsCollectedAt">>;

/**
 * PUR-03: trạng thái từng giai đoạn. Tạm ứng / thanh toán trước là tùy chọn: bước đề nghị xong khi khoản đã ký duyệt,
 * bước "Thực hiện chi" xong khi kế toán đã chi; bỏ qua khi đơn đã qua bước đó mà không có khoản nào.
 */
export function stepStates(order: StepOrder, payments: readonly Pick<PurchasePayment, "kind" | "status">[]): Record<FlowStepKey, StepState> {
  const rank = ORDER_RANK[order.status];
  const states = {} as Record<FlowStepKey, StepState>;
  const cancelled = order.status === "cancelled";
  const completed = order.status === "completed";
  // PRC-30: NCC không cần tạm ứng / thanh toán trước thì bước đó "Không dùng" ngay từ đầu
  const notNeeded = (kind: PaymentKind) => (kind === "advance" && order.advanceRequired === false) || (kind === "prepayment" && order.prepayRequired === false);
  const byRank = (key: FlowStepKey): StepState => rank > STEP_RANK[key] || completed ? "skipped" : "todo";
  for (const step of FLOW_STEPS) {
    const key = step.key;
    if (key === "failed") { states.failed = cancelled ? "current" : completed ? "skipped" : "todo"; continue; }
    if (key === "completed") { states.completed = completed ? "done" : "todo"; continue; }
    // PRC-34: bước PO chỉ có ở đơn dự án (đi chuỗi ký)
    if (key === "po") {
      if (!order.usesChain) states.po = "skipped";
      else if (cancelled) states.po = "todo";
      else if (order.supplierAcceptedAt || rank > ORDER_RANK.approved) states.po = "done";
      else states.po = order.status === "approved" ? "current" : "todo";
      continue;
    }
    if (key === "advance" || key === "prepayment") {
      const mine = payments.filter((payment) => payment.kind === key && payment.status !== "rejected");
      if (mine.some((payment) => payment.status === "requested")) states[key] = "current";
      else if (mine.some((payment) => payment.status === "approved" || payment.status === "paid")) states[key] = "done";
      else if (notNeeded(key)) states[key] = "skipped";
      else if (key === "advance" && order.advanceRequired && rank >= ORDER_RANK.approved && !cancelled) states[key] = poBlock(order) ? "todo" : "current";
      else states[key] = byRank(key);
      continue;
    }
    const payKind = PAY_STEPS[key];
    if (payKind) {
      const mine = payments.filter((payment) => payment.kind === payKind && payment.status !== "rejected");
      if (mine.some((payment) => payment.status === "approved")) states[key] = "current";
      else if (mine.some((payment) => payment.status === "paid")) states[key] = "done";
      else if (mine.length) states[key] = "todo";
      else if (payKind !== "final" && (states[payKind] === "skipped" || notNeeded(payKind))) states[key] = "skipped";
      else states[key] = byRank(key);
      continue;
    }
    if (cancelled) { states[key] = "todo"; continue; }
    if (key === "received" && order.status === "received") { states.received = "done"; continue; }
    if (key === "stocked") {
      states.stocked = order.stockedAt || completed ? "done" : order.status === "received" ? "current" : "todo";
      continue;
    }
    if (key === "final") {
      const pending = payments.some((payment) => payment.kind === "final" && payment.status === "requested");
      states.final = order.docsCollectedAt || completed ? (pending ? "current" : "done") : order.status === "received" && order.stockedAt ? "current" : "todo";
      continue;
    }
    // Đơn dự án: đã phát hành PO thì bước Duyệt đã xong, bước PO là bước hiện tại
    if (key === "approved" && order.usesChain && order.poIssuedAt) { states.approved = "done"; continue; }
    states[key] = rank > STEP_RANK[key] || completed ? "done" : rank === STEP_RANK[key] ? "current" : "todo";
  }
  return states;
}

export type PurchaseAction =
  | "edit" | "submit" | "approve" | "reject" | "order" | "track" | "requestAdvance" | "requestPrepayment" | "requestFinal"
  | "receive" | "stockIn" | "collectDocs" | "complete" | "cancel" | "decidePayment" | "pay" | "issuePo" | "supplierAccept";

/**
 * PUR-04: hành động được phép theo trạng thái đơn và vai trò (giống các hàm purchase_* ở Supabase).
 * Người lập: sửa và lập đơn khi nháp / bị từ chối; đặt hàng, đề nghị chi, nhận hàng, hoàn tất. Sếp: duyệt đơn, duyệt khoản chi,
 * và làm được mọi việc của người lập trừ sửa đơn. Kế toán (payer): chi khoản đã duyệt. Hủy: người lập trước khi đặt hàng, sếp hoặc Admin khi chưa xong.
 */
export function allowedActions(order: Pick<PurchaseOrder, "status" | "requesterId"> & Partial<Pick<PurchaseOrder, "usesChain" | "advanceRequired" | "prepayRequired" | "poIssuedAt" | "supplierAcceptedAt" | "stockedAt" | "docsCollectedAt">>, me: { userId: string; isAdmin: boolean; isProjectLead?: boolean; isPoIssuer?: boolean; /** Giai đoạn người xem làm được theo phòng ban được giao (purchase_stage_permissions). */ stages?: ReadonlySet<EnforcedStage> } & PurchaseRoles, payments: readonly (Pick<PurchasePayment, "status"> & Partial<Pick<PurchasePayment, "kind" | "usesChain">>)[] = []): Set<PurchaseAction> {
  const actions = new Set<PurchaseAction>();
  const mine = order.requesterId === me.userId;
  const handler = mine || me.isApprover || me.isAdmin;
  const status = order.status;
  const may = (stage: EnforcedStage) => me.isAdmin || Boolean(me.stages?.has(stage));
  if (mine && (status === "draft" || status === "rejected")) actions.add("edit");
  // Admin gửi ký được đơn của người khác (tự test cả quy trình)
  if ((mine || me.isAdmin) && (status === "draft" || status === "rejected")) actions.add("submit");
  if (me.isApprover && status === "submitted" && !order.usesChain) { actions.add("approve"); actions.add("reject"); }
  // PRC-31: NCC cần tạm ứng thì phải chi xong tạm ứng mới sang Đặt hàng, theo dõi
  if (handler && status === "approved" && !orderBlock(order, payments)) actions.add("order");
  // PRC-34: người lập / phụ trách dự án phát hành PO, rồi ghi nhận NCC ký nhận (Kho / Vật tư làm thay được)
  if (order.usesChain && status === "approved" && !order.poIssuedAt && (handler || me.isProjectLead || me.isPoIssuer)) actions.add("issuePo");
  if (order.usesChain && status === "approved" && order.poIssuedAt && !order.supplierAcceptedAt && (handler || me.isProjectLead || me.isPoIssuer)) actions.add("supplierAccept");
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
  if ((handler || me.isProjectLead || may("received")) && (status === "ordered" || (status === "received" && !order.stockedAt))) actions.add("receive");
  // Nhập kho (mặc định Kho) rồi thu thập chứng từ (mặc định P. Vật tư), rồi mới hoàn tất
  if (status === "received" && !order.stockedAt && may("stocked")) actions.add("stockIn");
  if (status === "received" && order.stockedAt && !order.docsCollectedAt && may("final")) actions.add("collectDocs");
  if ((handler || may("final")) && status === "received" && order.stockedAt && order.docsCollectedAt
    && !payments.some((payment) => payment.status === "requested" || payment.status === "approved")) actions.add("complete");
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
  issue_po: "Phát hành PO", supplier_accept: "NCC ký xác nhận PO", remind_supplier: "Đã nhắc NCC giao hàng",
  "payment_sign:pic": "Phụ trách ký đề nghị thanh toán", "payment_sign:technical": "P. Kỹ thuật ký đề nghị thanh toán", "payment_sign:material": "P. Vật tư ký đề nghị thanh toán",
  "sign:pic": "Phụ trách ký", "sign:technical": "P. Kỹ thuật ký", "sign:material": "P. Vật tư ký", "sign:accounting": "Kế toán ký", "sign:leader": "Lãnh đạo ký", "sign:admin_office": "Hành chánh ký nhận", order: "Đặt hàng", track: "Cập nhật theo dõi",
  receive: "Nhận hàng, kiểm đếm", stock_in: "Nhập kho", collect_docs: "Đã thu đủ chứng từ", complete: "Hoàn tất đơn (thành công)", cancel: "Hủy đơn (thất bại)",
  "payment_request:advance": "Đề nghị tạm ứng", "payment_request:prepayment": "Đề nghị thanh toán trước", "payment_request:final": "Đề nghị thanh toán còn lại",
  "payment_approve:advance": "Sếp duyệt tạm ứng", "payment_approve:prepayment": "Sếp duyệt thanh toán trước", "payment_approve:final": "Sếp duyệt thanh toán còn lại",
  "payment_reject:advance": "Sếp từ chối tạm ứng", "payment_reject:prepayment": "Sếp từ chối thanh toán trước", "payment_reject:final": "Sếp từ chối thanh toán còn lại",
  "paid:advance": "Đã chi tạm ứng", "paid:prepayment": "Đã chi thanh toán trước", "paid:final": "Đã chi thanh toán còn lại",
};

/** PUR-03: phần trăm tiến độ và tên bước hiện tại của đơn (cho thanh tiến độ ở danh sách). */
export function progressOf(status: PurchaseStatus, order?: Partial<Pick<PurchaseOrder, "stockedAt" | "docsCollectedAt">>): { percent: number; label: string } {
  if (status === "received" && order) {
    if (order.docsCollectedAt) return { percent: 93, label: "Đủ chứng từ, chờ thanh toán / hoàn tất" };
    if (order.stockedAt) return { percent: 88, label: "Đã nhập kho, chờ thu chứng từ" };
    return { percent: 80, label: "Đã nhận hàng, chờ nhập kho" };
  }
  const map: Record<PurchaseStatus, [number, string]> = {
    draft: [5, "Đang soạn nháp"], rejected: [5, "Sếp trả về, cần sửa"], submitted: [20, "Chờ sếp duyệt"], approved: [35, "Đã duyệt, chờ đặt hàng"],
    ordered: [60, "Đang theo dõi giao hàng"], received: [85, "Đã nhận, chờ thanh toán / hoàn tất"], completed: [100, "Hoàn tất"], cancelled: [0, "Đã hủy"],
  };
  const [percent, label] = map[status];
  return { percent, label };
}

/** Gợi ý việc tiếp theo cho người đang xem (hiện dưới thanh tiến trình). */
export function nextHint(order: Pick<PurchaseOrder, "status" | "requesterId"> & Partial<Pick<PurchaseOrder, "advanceRequired" | "prepayRequired" | "usesChain" | "poIssuedAt" | "supplierAcceptedAt" | "stockedAt" | "docsCollectedAt">>,me: { userId: string } & PurchaseRoles, payments: readonly (Pick<PurchasePayment, "status"> & Partial<Pick<PurchasePayment, "kind">>)[]): string {
  const mine = order.requesterId === me.userId;
  if (me.isApprover && order.status === "submitted") return "Bạn là người duyệt: xem hàng cần mua rồi bấm Duyệt đơn hoặc Từ chối.";
  if (me.isApprover && payments.some((payment) => payment.status === "requested")) return "Có khoản tạm ứng / thanh toán đang chờ duyệt ở mục Tạm ứng và thanh toán.";
  if (me.isPayer && payments.some((payment) => payment.status === "approved")) return "Có khoản đã được sếp duyệt chờ bạn Thực hiện chi.";
  switch (order.status) {
    case "draft": return mine ? "Kiểm tra lại hàng cần mua rồi bấm Lập đơn, gửi duyệt." : "Đơn đang được soạn.";
    case "rejected": return mine ? "Sếp đã trả về: sửa theo góp ý rồi lập lại." : "Sếp đã trả về cho người lập sửa.";
    case "submitted": return "Đang chờ sếp duyệt.";
    case "approved": return order.usesChain && !order.poIssuedAt
      ? "Đã duyệt. Người lập phát hành PO chính thức (P-CC-08) gửi nhà cung cấp."
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
    case "received": return !order.stockedAt
      ? "Đã nhận hàng, kiểm đếm. Kho lập phiếu nhập kho: bấm Nhập kho (còn sai số lượng thì sửa lại Nhận hàng trước khi nhập kho)."
      : !order.docsCollectedAt
        ? "Đã nhập kho. Thu thập chứng từ (hóa đơn GTGT, biên bản giao nhận, phiếu nhập kho, CO/CQ…) rồi bấm Đã thu đủ chứng từ; đề nghị thanh toán phần còn lại nếu còn."
        : "Đủ chứng từ. Đề nghị thanh toán phần còn lại (nếu còn), kế toán chi xong thì bấm Hoàn tất đơn (Thành công).";
    case "completed": return "Đơn đã hoàn tất.";
    default: return "Đơn đã hủy.";
  }
}

/** Bước trên thanh tiến trình mới: như FLOW_STEPS nhưng tách "Hóa đơn, chứng từ cho kho" khỏi đề nghị thanh toán cuối. */
export type PathKey = Exclude<FlowStepKey, "failed"> | "docs";
export type PathStep = { key: PathKey; label: string; state: StepState; /** Giai đoạn để lấy phòng ban phụ trách. */ stage: AssignableStage | null };
export const PATH_LABELS: Record<PathKey, string> = {
  draft: "Đơn nháp", submitted: "Gửi ký duyệt", approved: "Duyệt", po: "PO, NCC ký nhận", advance: "Đề nghị tạm ứng", advance_pay: "Chi tạm ứng",
  ordered: "Theo dõi đơn hàng", prepayment: "Đề nghị TT trước giao", prepayment_pay: "Chi TT trước giao", received: "Nhận hàng, kiểm đếm", stocked: "Nhập kho",
  docs: "Hóa đơn, chứng từ cho kho", final: "Đề nghị thanh toán", final_pay: "Chi thanh toán", completed: "Hoàn tất",
};
/** Điều kiện thanh toán của đơn (hai lựa chọn trên form): trước khi nhận hàng (kèm tạm ứng có / không) hoặc sau khi nhận hàng. */
export const payBeforeDelivery = (order: Partial<Pick<PurchaseOrder, "advanceRequired" | "prepayRequired">>) => Boolean(order.prepayRequired || order.advanceRequired);
export function paymentTermsLabel(order: Partial<Pick<PurchaseOrder, "advanceRequired" | "advancePct" | "prepayRequired">>): string {
  if (!payBeforeDelivery(order)) return "Thanh toán sau khi nhận hàng";
  return order.advanceRequired ? `Thanh toán trước khi nhận hàng · Tạm ứng ${order.advancePct ?? 0}%` : "Thanh toán trước khi nhận hàng · Không tạm ứng";
}

/**
 * Các bước của riêng một đơn theo điều kiện thanh toán (mỗi đơn khác nhau):
 * Nháp → Gửi ký → Duyệt → [PO] → [Tạm ứng → Chi tạm ứng] → Theo dõi → [Đề nghị TT trước giao → Chi] → Nhận hàng → Nhập kho
 * → Hóa đơn, chứng từ cho kho → [Đề nghị thanh toán → Chi] → Hoàn tất. Bước trong [] chỉ có khi đơn cần (hoặc đã có khoản đó).
 */
export function orderPath(order: StepOrder & Partial<Pick<PurchaseOrder, "advancePct">>, payments: readonly Pick<PurchasePayment, "kind" | "status">[]): PathStep[] {
  const states = stepStates(order, payments);
  const has = (kind: PaymentKind) => payments.some((payment) => payment.kind === kind && payment.status !== "rejected");
  const completed = order.status === "completed";
  const keys: PathKey[] = ["draft", "submitted", "approved"];
  if (order.usesChain) keys.push("po");
  if (order.advanceRequired || has("advance")) keys.push("advance", "advance_pay");
  keys.push("ordered");
  if (order.prepayRequired || has("prepayment")) keys.push("prepayment", "prepayment_pay");
  keys.push("received", "stocked", "docs");
  // Thanh toán sau nhận hàng luôn có; trả trước thì chỉ khi còn phần thanh toán cuối
  if (!payBeforeDelivery(order) || has("final")) keys.push("final", "final_pay");
  keys.push("completed");

  const finalPays = payments.filter((payment) => payment.kind === "final" && payment.status !== "rejected");
  const docsDone = Boolean(order.docsCollectedAt) || completed;
  const stateOf = (key: PathKey): StepState => {
    if (key === "docs") return docsDone ? "done" : order.status === "received" && order.stockedAt ? "current" : "todo";
    if (key === "final") {
      if (finalPays.some((payment) => payment.status === "requested")) return "current";
      if (finalPays.some((payment) => payment.status === "approved" || payment.status === "paid")) return "done";
      return completed ? "skipped" : docsDone ? "current" : "todo";
    }
    const state = states[key];
    // Bước đã chọn trong điều kiện thanh toán thì không "Không dùng" khi chưa tới
    return state === "skipped" && !completed && order.status !== "cancelled" ? "todo" : state;
  };
  const steps = keys.map((key) => ({ key, label: PATH_LABELS[key], state: stateOf(key), stage: key === "docs" ? "final" as const : key === "completed" ? null : key }));
  // Chỉ một bước "đang ở": bước current đầu tiên; các bước current sau đó (chạy song song) giữ nguyên để người dùng thấy
  if (!steps.some((step) => step.state === "current") && order.status !== "cancelled" && !completed) {
    const next = steps.find((step) => step.state === "todo");
    if (next) next.state = "current";
  }
  return steps;
}

/**
 * Bước trên thanh tiến trình mà một hoạt động trong nhật ký đơn thuộc về (để bấm vào bước xem lịch sử của bước đó).
 * Ký đề nghị thanh toán (payment_sign:*) không ghi loại khoản: gán theo đề nghị gần nhất trước thời điểm ký.
 */
export function eventStep(event: { action: string; at: string }, payments: readonly Pick<PurchasePayment, "kind" | "requestedAt">[] = []): PathKey {
  const [verb, detail] = event.action.split(":");
  const kind = (detail === "advance" || detail === "prepayment" || detail === "final") ? detail as PaymentKind : null;
  const requestStep: Record<PaymentKind, PathKey> = { advance: "advance", prepayment: "prepayment", final: "final" };
  const payStep: Record<PaymentKind, PathKey> = { advance: "advance_pay", prepayment: "prepayment_pay", final: "final_pay" };
  switch (verb) {
    case "create": return "draft";
    case "submit": case "sign": return "submitted";
    case "approve": case "reject": return "approved";
    case "issue_po": case "supplier_accept": return "po";
    case "order": case "track": case "remind_supplier": return "ordered";
    case "receive": return "received";
    case "stock_in": return "stocked";
    case "collect_docs": return "docs";
    case "complete": case "cancel": return "completed";
    case "payment_request": case "payment_approve": case "payment_reject": return kind ? requestStep[kind] : "final";
    case "paid": return kind ? payStep[kind] : "final_pay";
    case "payment_sign": {
      const before = [...payments].filter((payment) => payment.requestedAt <= event.at).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
      return before ? requestStep[before.kind] : "final";
    }
    default: return "ordered";
  }
}
