import { apiFetch } from "./auth";
import { supabase } from "./supabase";

/**
 * Duyệt phiếu trên app (dùng chung với bảng "Đơn phiếu cần duyệt" của web, RPC my_approval_board):
 * yêu cầu vật tư, đơn đặt hàng, đề nghị thanh toán, ngân sách… Ký / trả về bước đang chờ; Giám đốc duyệt thẳng được.
 */
export type ApprovalColumn = "todo" | "waiting" | "approved" | "returned";
export type ApprovalCard = {
  docType: string; docId: string; projectCode: string; title: string; amount: number; creatorName: string; column: ApprovalColumn;
  stepId: string | null; role: string | null; assignee: string; targetDate: string | null; canSign: boolean; signed: number; total: number; updatedAt: string; link: string;
};

export const DOC_LABEL: Record<string, string> = {
  material: "Yêu cầu vật tư", purchase: "Đơn đặt hàng", payment: "Đề nghị thanh toán", budget: "Ngân sách", explanatory: "Báo cáo giải thích", contract: "Confirm Contract",
};
/** Các loại phiếu của mua hàng. */
export const PURCHASING = new Set(["material", "purchase", "payment"]);
export const ROLE_LABEL: Record<string, string> = {
  pic: "Phụ trách", technical: "P. Kỹ thuật", material: "P. Vật tư", accounting: "P. Kế toán", leader: "Lãnh đạo", admin_office: "P. HC-KT",
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const KNOWN: Record<string, string> = {
  STEP_NOT_YOURS: "Bước này không phải của bạn ký.", NOT_DIRECTOR: "Chỉ Giám đốc duyệt thẳng được.", FORBIDDEN: "Bạn không có quyền với phiếu này.",
  PO_OVER_BUDGET: "Đơn vượt ngân sách, cần ghi lý do.", PO_REASON_REQUIRED: "Cần ghi lý do.", BAD_INPUT: "Dữ liệu chưa hợp lệ.",
};
const fail = (error: { message: string } | null) => {
  if (!error) return;
  throw new Error(Object.entries(KNOWN).find(([code]) => error.message.includes(code))?.[1] ?? error.message);
};

export async function loadBoard(): Promise<ApprovalCard[]> {
  const { data, error } = await supabase.rpc("my_approval_board");
  fail(error);
  return ((data ?? []) as Row[]).map((row) => ({
    docType: str(row.doc_type), docId: str(row.doc_id), projectCode: str(row.project_code), title: str(row.title), amount: Number(row.amount ?? 0),
    creatorName: str(row.creator_name), column: str(row.column_key) as ApprovalColumn, stepId: row.current_step_id ? str(row.current_step_id) : null,
    role: row.step_role ? str(row.step_role) : null, assignee: str(row.current_assignee), targetDate: row.current_target ? str(row.current_target) : null,
    canSign: Boolean(row.can_sign), signed: Number(row.signed_count ?? 0), total: Number(row.total_count ?? 0), updatedAt: str(row.updated_at), link: str(row.link),
  }));
}

export async function isDirector(): Promise<boolean> {
  const { data } = await supabase.rpc("my_account");
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
  return Boolean(row?.is_director) || str(row?.role) === "admin";
}

/** Gửi email thông báo cho người ký tiếp (giống bản web), lỗi thì bỏ qua. */
const dispatchEmails = () => { setTimeout(() => void apiFetch("/api/notifications/approvals", { method: "POST" }).catch(() => undefined), 300); };

export async function sign(stepId: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc("approval_sign", { p_step: stepId, p_approve: approve, p_note: note });
  fail(error);
  dispatchEmails();
}
export async function directorApprove(docType: string, docId: string, note: string) {
  const { error } = await supabase.rpc("approval_director_approve", { p_type: docType, p_doc: docId, p_note: note });
  fail(error);
  dispatchEmails();
}

export const money = (value: number) => `${Math.round(value).toLocaleString("vi-VN")} đ`;
