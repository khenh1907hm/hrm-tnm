import { supabase } from "./supabase";

/**
 * Thông báo trong app — dùng chung với chuông trên web (bảng user_notifications):
 * phiếu đến lượt mình ký, bị trả về, đã duyệt… Sau này thêm thông báo đẩy (push) thì vẫn đọc từ đây.
 */
export type AppNotification = { id: string; kind: string; title: string; body: string; link: string; createdAt: string; readAt: string | null };

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export async function loadNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc("my_notifications", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id), kind: str(row.kind), title: str(row.title), body: str(row.body), link: str(row.link),
    createdAt: str(row.created_at), readAt: row.read_at ? str(row.read_at) : null,
  }));
}

/** Đánh dấu đã đọc; không truyền ids = tất cả. */
export async function markRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc("notifications_mark_read", { p_ids: ids ?? null });
  if (error) throw new Error(error.message);
}

export const webBase = () => process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://tnm.com.vn";

/** "5 phút trước", "3 giờ trước", "12/11". */
export function ago(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 60_000;
  if (diff < 1) return "Vừa xong";
  if (diff < 60) return `${Math.floor(diff)} phút trước`;
  if (diff < 24 * 60) return `${Math.floor(diff / 60)} giờ trước`;
  if (diff < 7 * 24 * 60) return `${Math.floor(diff / 1440)} ngày trước`;
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
