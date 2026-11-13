"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mỗi tài khoản chỉ đăng nhập một nơi, tối đa 24 giờ:
 *  - Đăng nhập xong: tạo khóa phiên lưu ở trình duyệt, ghi lên máy chủ (session_claim), thu hồi các phiên khác (signOut scope "others").
 *  - Định kỳ và khi quay lại tab: hỏi máy chủ (session_check). "replaced" = đã đăng nhập nơi khác; "expired" = quá 24 giờ → đăng xuất máy này.
 */
const KEY = "tnm.sessionKey";
export const KICK_MESSAGE_KEY = "tnm.kickMessage";

function readKey(): string | null {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}
function writeKey(value: string | null) {
  try { if (value) window.localStorage.setItem(KEY, value); else window.localStorage.removeItem(KEY); } catch { /* trình duyệt chặn lưu trữ */ }
}
function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let claiming: Promise<void> | null = null;

/** Gọi ngay sau khi đăng nhập bằng mật khẩu thành công. */
export function claimSession(client: SupabaseClient): Promise<void> {
  // Một lần nhận phiên tại một thời điểm (tránh kiểm tra định kỳ chen vào giữa rồi nhận phiên lần nữa)
  claiming ??= doClaim(client).finally(() => { claiming = null; });
  return claiming;
}

async function doClaim(client: SupabaseClient): Promise<void> {
  const key = newKey();
  writeKey(key);
  const { error } = await client.rpc("session_claim", { p_key: key, p_agent: navigator.userAgent.slice(0, 300) });
  if (error) return;
  // Thu hồi phiên ở các nơi khác (họ sẽ bị đăng xuất khi hết hạn token hoặc lần kiểm tra kế tiếp)
  await client.auth.signOut({ scope: "others" }).catch(() => undefined);
}

export type SessionState = "ok" | "replaced" | "expired";

/** Kiểm tra phiên máy này. Phiên cũ chưa có khóa (đăng nhập trước khi có tính năng) thì nhận làm phiên chính. */
export async function checkSession(client: SupabaseClient): Promise<SessionState> {
  if (claiming) await claiming;
  const key = readKey();
  if (!key) { await claimSession(client); return "ok"; }
  const { data, error } = await client.rpc("session_check", { p_key: key });
  if (error) return "ok";
  if (data === "none") { await claimSession(client); return "ok"; }
  return data === "replaced" || data === "expired" ? data : "ok";
}

/** Đăng xuất riêng máy này (không đụng phiên mới ở nơi khác), để lại lý do cho màn hình đăng nhập. */
export async function kickLocal(client: SupabaseClient, state: Exclude<SessionState, "ok">): Promise<void> {
  const message = state === "replaced"
    ? "Tài khoản vừa đăng nhập ở nơi khác nên máy này đã được đăng xuất."
    : "Phiên đăng nhập đã quá 24 giờ, vui lòng đăng nhập lại.";
  try { window.sessionStorage.setItem(KICK_MESSAGE_KEY, message); } catch { /* bỏ qua */ }
  writeKey(null);
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
}

export function forgetSessionKey() { writeKey(null); }

/** Lý do vừa bị đăng xuất (đọc một lần). */
export function takeKickMessage(): string | null {
  try {
    const message = window.sessionStorage.getItem(KICK_MESSAGE_KEY);
    if (message) window.sessionStorage.removeItem(KICK_MESSAGE_KEY);
    return message;
  } catch { return null; }
}
