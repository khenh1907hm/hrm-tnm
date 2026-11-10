import type { PaymentKind, PurchaseApprover, PurchaseDraft, PurchaseEvent, PurchaseOrder, PurchasePayment, PurchaseRoles, ReceiveLine } from "./types";

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
  requestPayment(id: string, kind: PaymentKind, amount: number, payee: string, note: string): Promise<void>;
  decidePayment(paymentId: string, approve: boolean, note: string): Promise<void>;
  pay(paymentId: string, method: string, note: string): Promise<void>;
  receive(id: string, lines: readonly ReceiveLine[], note: string): Promise<void>;
  complete(id: string, note: string): Promise<void>;
  cancel(id: string, note: string): Promise<void>;
}
