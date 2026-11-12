import { getSupabaseClient } from "./supabase/client";

/**
 * Nhờ máy chủ gửi email cho các thông báo duyệt mới (không chờ; lỗi bỏ qua vì lịch chạy định kỳ gửi lại sau).
 * Gọi sau khi gửi / ký / duyệt một phiếu.
 */
export function dispatchNotificationEmails() {
  if (typeof window === "undefined") return;
  const client = getSupabaseClient();
  if (!client) return;
  void client.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token;
    if (!token) return;
    // Chờ một nhịp cho giao dịch ký ghi xong
    window.setTimeout(() => void fetch("/api/notifications/approvals", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined), 300);
  }, () => undefined);
}
