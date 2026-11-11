import type { ApprovalDocType, ApprovalStep, Department, DepartmentMembers } from "./approval";
import type { BudgetLine, BudgetSheet, BudgetSheetHeader, CostCode } from "./budget";
import type { PaymentRequestInput, PurchaseApprover, PurchaseDraft, PurchaseEvent, PurchaseOrder, PurchasePayment, PurchaseRoles, ReceiveLine } from "./types";

/**
 * Nguồn dữ liệu đặt hàng: bộ nhớ (demo, người dùng demo là Admin + người duyệt + người chi) hoặc Supabase (RLS + hàm purchase_*).
 * Lỗi nghiệp vụ ném Error có message là mã (vd "PO_NOT_APPROVER"), dùng errorCode() ở modules/projects/store.
 */
export interface PurchaseStore {
  readonly mode: "demo" | "live";
  myUserId(): Promise<string>;
  myRoles(): Promise<PurchaseRoles>;
  approvers(): Promise<PurchaseApprover[]>;
  setApprovers(employeeIds: readonly string[]): Promise<void>;

  listOrders(): Promise<PurchaseOrder[]>;
  getOrder(id: string): Promise<PurchaseOrder | null>;
  saveDraft(draft: PurchaseDraft & { id?: string }): Promise<PurchaseOrder>;
  deleteDraft(id: string): Promise<void>;
  listPayments(orderId: string): Promise<PurchasePayment[]>;
  /** Khoản chi đang chờ sếp duyệt hoặc chờ chi (trong các đơn người xem thấy). */
  listPendingPayments(): Promise<PurchasePayment[]>;
  listEvents(orderId: string): Promise<PurchaseEvent[]>;

  submit(id: string): Promise<void>;
  decide(id: string, approve: boolean, note: string): Promise<void>;
  markOrdered(id: string, supplier: string, contact: string, expected: string | null, note: string): Promise<void>;
  track(id: string, note: string, expected: string | null): Promise<void>;
  requestPayment(id: string, input: PaymentRequestInput): Promise<void>;
  decidePayment(paymentId: string, approve: boolean, note: string): Promise<void>;
  pay(paymentId: string, method: string, note: string): Promise<void>;
  receive(id: string, lines: readonly ReceiveLine[], note: string): Promise<void>;
  complete(id: string, note: string): Promise<void>;
  cancel(id: string, note: string): Promise<void>;

  /* Mua hàng dự án theo quy trình (giai đoạn A): mã chi phí, ngân sách theo mã, chuỗi ký. */
  costCodes(): Promise<CostCode[]>;
  listBudgetSheets(projectId: string): Promise<BudgetSheet[]>;
  /** Lập lần ngân sách mới (chép từ lần mới nhất); trả về id. */
  newBudgetSheet(projectId: string): Promise<string>;
  saveBudgetSheet(id: string, header: BudgetSheetHeader, lines: readonly BudgetLine[]): Promise<void>;
  submitBudgetSheet(id: string): Promise<void>;
  deleteBudgetSheet(id: string): Promise<void>;
  /** A (ngân sách của mã) và B (đã đặt, trừ đơn đang xét) theo lần ngân sách đã duyệt mới nhất; null khi dự án chưa có ngân sách duyệt. */
  checkBudget(projectId: string, code: string, orderId: string | null): Promise<{ sheetNumber: string; a: number; b: number } | null>;
  listSteps(docType: ApprovalDocType, docId: string): Promise<(ApprovalStep & { canSign: boolean })[]>;
  sign(stepId: string, approve: boolean, note: string): Promise<void>;
  myApprovals(): Promise<PendingApproval[]>;
  departments(): Promise<{ department: Department; employeeId: string; name: string }[]>;
  setDepartments(members: DepartmentMembers): Promise<void>;
}

/** Một phiếu đang chờ người đăng nhập ký. */
export type PendingApproval = { stepId: string; docType: ApprovalDocType; docId: string; projectId: string | null; projectCode: string; title: string; amount: number; role: ApprovalStep["role"]; targetDate: string;
  /** Đề nghị thanh toán: đơn hàng chứa khoản đó (để mở). */
  orderId?: string };
