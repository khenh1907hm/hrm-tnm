import type { ApprovalDocType, ApprovalStep, Department, DepartmentMembers } from "./approval";
import type { BudgetLine, BudgetSheet, BudgetSheetHeader, CostCode } from "./budget";
import type { ContractDraft, ProjectContract } from "./contract";
import type { ExplanatoryDraft, ExplanatoryReport } from "./explanatory";
import type { MaterialQuote, MaterialQuoteDraft, MaterialRequest, MaterialRequestDraft } from "./materials";
import type { PaymentRequestInput, ReceiptRecord, PurchaseApprover, PurchaseDraft, PurchaseEvent, PurchaseOrder, PurchasePayment, PurchaseRoles, ReceiveLine } from "./types";

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
  receive(id: string, lines: readonly ReceiveLine[], note: string, record?: ReceiptRecord): Promise<void>;
  /** Hành chánh phát hành PO chính thức (đơn dự án đã được Lãnh đạo duyệt); ký luôn bước Hành chánh nếu đang chờ. */
  issuePo(id: string, supplier: string, contact: string): Promise<void>;
  /** Ghi nhận NCC đã ký bản sao PO gửi lại (ngày, ghi chú nơi lưu bản ký). */
  supplierAccept(id: string, note: string): Promise<void>;
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

  /* Báo cáo giải thích P-COST-05: Lãnh đạo duyệt thì ngân sách các mã có E > 0 được cộng thêm E. */
  listExplanatory(projectId: string): Promise<ExplanatoryReport[]>;
  saveExplanatory(draft: ExplanatoryDraft): Promise<string>;
  submitExplanatory(id: string): Promise<void>;
  deleteExplanatory(id: string): Promise<void>;

  /* Yêu cầu vật tư P-COST-08, hỏi giá, bảng so sánh, lên đơn nháp. */
  listMaterialRequests(projectId: string): Promise<MaterialRequest[]>;
  saveMaterialRequest(draft: MaterialRequestDraft): Promise<string>;
  submitMaterialRequest(id: string): Promise<void>;
  deleteMaterialRequest(id: string): Promise<void>;
  closeMaterialRequest(id: string, note: string): Promise<void>;
  /** Mã ngân sách từng dòng (P. Vật tư điền khi hỏi giá, phiếu đã duyệt). */
  setMaterialCodes(id: string, codes: Record<string, string | null>): Promise<void>;
  listQuotes(requestId: string): Promise<MaterialQuote[]>;
  saveQuote(draft: MaterialQuoteDraft): Promise<string>;
  deleteQuote(id: string): Promise<void>;
  /** Chọn báo giá và lập đơn đặt hàng nháp (mỗi mã ngân sách một đơn); trả về id các đơn. */
  ordersFromQuote(requestId: string, quoteId: string): Promise<string[]>;

  /* Xác nhận dự án P-COST-01 (mỗi lần sửa hợp đồng là một lần mới). */
  listContracts(projectId: string): Promise<ProjectContract[]>;
  newContract(projectId: string): Promise<string>;
  saveContract(id: string, draft: ContractDraft): Promise<void>;
  submitContract(id: string): Promise<void>;
  deleteContract(id: string): Promise<void>;
}

/** Một phiếu đang chờ người đăng nhập ký. */
export type PendingApproval = { stepId: string; docType: ApprovalDocType; docId: string; projectId: string | null; projectCode: string; title: string; amount: number; role: ApprovalStep["role"]; targetDate: string;
  /** Đề nghị thanh toán: đơn hàng chứa khoản đó (để mở). */
  orderId?: string };

/** Mục của dự án mở được theo đường dẫn ?muc=… (tab). */
export const DOC_PROJECT_TAB: Partial<Record<ApprovalDocType, string>> = { budget: "ngan-sach", explanatory: "ngan-sach", material: "yeu-cau-vat-tu", contract: "hop-dong" };
