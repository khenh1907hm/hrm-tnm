/** Đặt hàng (mua hàng) cho dự án hoặc văn phòng, có phê duyệt (migration 20261112090000_purchase_orders.sql). */

export type PurchaseKind = "project" | "office";
export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = { project: "Dự án", office: "Văn phòng" };

export type PurchaseStatus = "draft" | "submitted" | "approved" | "rejected" | "ordered" | "received" | "completed" | "cancelled";
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "Nháp",
  submitted: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Bị từ chối",
  ordered: "Đang theo dõi",
  received: "Đã nhận hàng",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

export type PurchaseItem = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  receivedQty: number;
  acceptedQty: number;
  inspectionNote: string;
};

export type PurchaseOrder = {
  id: string;
  code: string;
  kind: PurchaseKind;
  projectId: string | null;
  title: string;
  requesterId: string;
  requesterName: string;
  department: string;
  neededBy: string | null;
  deliveryAddress: string;
  supplier: string;
  supplierContact: string;
  expectedDelivery: string | null;
  note: string;
  status: PurchaseStatus;
  totalEstimate: number;
  totalActual: number | null;
  decisionNote: string;
  submittedAt: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items: PurchaseItem[];
};

export type PurchaseDraft = Pick<PurchaseOrder, "kind" | "projectId" | "title" | "department" | "neededBy" | "deliveryAddress" | "supplier" | "supplierContact" | "note"> & { items: Omit<PurchaseItem, "receivedQty" | "acceptedQty" | "inspectionNote">[] };

export type PaymentKind = "advance" | "prepayment" | "final";
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = { advance: "Tạm ứng", prepayment: "Thanh toán trước", final: "Thanh toán còn lại" };
export type PurchasePaymentStatus = "requested" | "approved" | "paid" | "rejected";
export const PURCHASE_PAYMENT_STATUS_LABELS: Record<PurchasePaymentStatus, string> = { requested: "Chờ sếp duyệt", approved: "Chờ chi", paid: "Đã chi", rejected: "Từ chối" };

export type PurchasePayment = {
  id: string;
  orderId: string;
  kind: PaymentKind;
  amount: number;
  payee: string;
  note: string;
  status: PurchasePaymentStatus;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  paidMethod: string;
  decisionNote: string;
};

export type PurchaseEvent = { id: string; orderId: string; at: string; actorName: string; action: string; note: string };

/** Vai trò của người đăng nhập với đặt hàng (hàm purchase_my_roles). */
export type PurchaseRoles = { isApprover: boolean; isPayer: boolean; seesAll: boolean };
export type PurchaseApprover = { employeeId: string; name: string; hasAccount: boolean };

export type ReceiveLine = { id: string; receivedQty: number; acceptedQty: number; note: string };
