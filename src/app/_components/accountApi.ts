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

export async function setProjectApprovers(projectId: string, items: readonly { role: ApprovalRole; employeeId: string }[]) {
  await rpc("project_approvers_set", { p_project: projectId, p_items: items });
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
