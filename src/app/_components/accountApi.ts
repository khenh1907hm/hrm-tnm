"use client";
import { getSupabaseClient } from "../../lib/supabase/client";
import { dispatchNotificationEmails } from "../../lib/approvalEmailDispatch";
export { dispatchNotificationEmails };
import type { ApprovalRole } from "../../modules/purchases/approval";

/**
 * Gọi các hàm máy chủ cho góc phải (thông báo, hồ sơ), người duyệt theo dự án và Giám đốc duyệt ngay.
 * Chế độ demo (không có Supabase) trả về rỗng.
 */
export type MyAccount = { fullName: string; role: string; isDirector: boolean; employeeId: string | null; loginEmail: string; notifyEmail: string; notifyEnabled: boolean };
export type AppNotification = { id: string; kind: "approval_pending" | "approval_returned" | "approval_approved"; title: string; body: string; link: string; createdAt: string; readAt: string | null };
export type ProjectApprover = { role: ApprovalRole; employeeId: string; code: string; name: string };

type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as unknown;
}

let accountCache: Promise<MyAccount | null> | null = null;
export function myAccount(refresh = false): Promise<MyAccount | null> {
  if (!accountCache || refresh) {
    accountCache = rpc("my_account").then((data) => {
      const row = (data as Row[] | null)?.[0];
      return row ? {
        fullName: str(row.full_name), role: str(row.role), isDirector: Boolean(row.is_director), employeeId: row.employee_id ? str(row.employee_id) : null,
        loginEmail: str(row.login_email), notifyEmail: str(row.notify_email), notifyEnabled: row.notify_enabled !== false,
      } : null;
    }, () => null);
  }
  return accountCache;
}

export async function saveNotifySettings(email: string, enabled: boolean) {
  await rpc("my_notify_settings_save", { p_email: email, p_enabled: enabled });
  await myAccount(true);
}

export async function myNotifications(limit = 30): Promise<AppNotification[]> {
  return (((await rpc("my_notifications", { p_limit: limit })) ?? []) as Row[]).map((row) => ({
    id: str(row.id), kind: str(row.kind) as AppNotification["kind"], title: str(row.title), body: str(row.body), link: str(row.link),
    createdAt: str(row.created_at), readAt: row.read_at ? str(row.read_at) : null,
  }));
}

export async function markNotificationsRead(ids: string[] | null) { await rpc("notifications_mark_read", { p_ids: ids }); }

export async function projectApprovers(projectId: string): Promise<ProjectApprover[]> {
  return (((await rpc("project_approvers_of", { p_project: projectId })) ?? []) as Row[]).map((row) => ({
    role: str(row.role) as ApprovalRole, employeeId: str(row.employee_id), code: str(row.code), name: str(row.name),
  }));
}

/** Trạng thái Confirm Contract mới nhất của từng dự án: quyết định dự án đã "tạo thành công" chưa. */
export type ContractState = "none" | "draft" | "submitted" | "approved" | "rejected";
export const CONTRACT_STATE_UI: Record<ContractState, { label: string; tone: "ok" | "bad" | "wait" }> = {
  approved: { label: "Đã duyệt Confirm Contract", tone: "ok" },
  rejected: { label: "Confirm Contract bị từ chối", tone: "bad" },
  submitted: { label: "Chờ duyệt Confirm Contract", tone: "wait" },
  draft: { label: "Confirm Contract nháp, chưa gửi duyệt", tone: "wait" },
  none: { label: "Chưa lập Confirm Contract", tone: "wait" },
};
export async function projectContractStates(): Promise<Record<string, ContractState>> {
  const rows = ((await rpc("project_contract_states")) ?? []) as Row[];
  return Object.fromEntries(rows.map((row) => [str(row.project_id), (str(row.status) || "none") as ContractState]));
}

/** Giám đốc: luôn ở khung Lãnh đạo của mọi dự án. */
export async function directorPeople(): Promise<{ employeeId: string; name: string }[]> {
  return (((await rpc("director_people")) ?? []) as Row[]).map((row) => ({ employeeId: str(row.employee_id), name: str(row.name) }));
}

/** Kiểu duyệt của một khối khi có nhiều người: một người là đủ, hoặc lần lượt từng người theo thứ tự. */
export type ApprovalMode = "any" | "sequence";
export type ApprovalModes = Partial<Record<ApprovalRole, ApprovalMode>>;

/** Lưu người duyệt (đúng thứ tự trong danh sách) và kiểu duyệt từng vai trò của dự án. */
export async function setProjectApprovers(projectId: string, items: readonly { role: ApprovalRole; employeeId: string }[], modes?: ApprovalModes) {
  await rpc("project_approvers_set", { p_project: projectId, p_items: items, p_modes: modes ?? null });
}

export async function projectApprovalModes(projectId: string): Promise<ApprovalModes> {
  const client = getSupabaseClient();
  if (!client) return {};
  const { data } = await client.from("projects").select("approval_modes").eq("id", projectId).maybeSingle();
  return ((data?.approval_modes ?? {}) as ApprovalModes);
}

/** Cấu hình chung (Admin): người từng bộ phận theo thứ tự và kiểu duyệt. */
export type ApprovalSettings = { departments: Record<string, string[]>; modes: ApprovalModes; names: Record<string, string> };
export async function approvalSettings(): Promise<ApprovalSettings> {
  const client = getSupabaseClient();
  if (!client) return { departments: {}, modes: {}, names: {} };
  const [{ data, error }, people] = await Promise.all([
    client.from("procurement_settings").select("departments, modes").eq("id", 1).maybeSingle(),
    rpc("procurement_departments"),
  ]);
  if (error) throw new Error(error.message);
  const names = Object.fromEntries(((people ?? []) as Row[]).map((row) => [str(row.employee_id), str(row.name)]));
  return { departments: (data?.departments ?? {}) as Record<string, string[]>, modes: (data?.modes ?? {}) as ApprovalModes, names };
}
export async function saveApprovalSettings(departments: Record<string, string[]>, modes: ApprovalModes) {
  await rpc("approval_settings_save", { p_departments: departments, p_modes: modes });
}

/** Một phiếu trên bảng "Đơn phiếu cần duyệt của tôi". */
export type BoardColumn = "todo" | "waiting" | "approved" | "returned";
export type BoardCard = {
  docType: string; docId: string; projectId: string | null; projectCode: string; title: string; amount: number; creatorName: string; column: BoardColumn;
  stepId: string | null; role: ApprovalRole | null; assignee: string; targetDate: string | null; canSign: boolean; signed: number; total: number; updatedAt: string; link: string;
};
export async function approvalBoard(): Promise<BoardCard[]> {
  return (((await rpc("my_approval_board")) ?? []) as Row[]).map((row) => ({
    docType: str(row.doc_type), docId: str(row.doc_id), projectId: row.project_id ? str(row.project_id) : null, projectCode: str(row.project_code), title: str(row.title),
    amount: Number(row.amount ?? 0), creatorName: str(row.creator_name), column: str(row.column_key) as BoardColumn,
    stepId: row.current_step_id ? str(row.current_step_id) : null, role: row.step_role ? (str(row.step_role) as ApprovalRole) : null,
    assignee: str(row.current_assignee), targetDate: row.current_target ? str(row.current_target) : null, canSign: Boolean(row.can_sign),
    signed: Number(row.signed_count ?? 0), total: Number(row.total_count ?? 0), updatedAt: str(row.updated_at), link: str(row.link),
  }));
}

/** Ký hoặc trả về bước đang chờ của một phiếu. */
export async function signStep(stepId: string, approve: boolean, note: string) {
  await rpc("approval_sign", { p_step: stepId, p_approve: approve, p_note: note });
  dispatchNotificationEmails();
}

export async function directorApprove(docType: string, docId: string, note: string) {
  await rpc("approval_director_approve", { p_type: docType, p_doc: docId, p_note: note });
  dispatchNotificationEmails();
}

/** Mở đường dẫn trong app không tải lại trang. */
export function openAppLink(link: string) {
  if (!link) return;
  // Đang ở đúng trang (chỉ khác ?muc=) thì tải lại để mở đúng mục; khác trang thì Next tự đổi theo pushState
  const target = new URL(link, window.location.origin);
  if (target.pathname === window.location.pathname) { window.location.assign(link); return; }
  window.history.pushState(null, "", link);
}
