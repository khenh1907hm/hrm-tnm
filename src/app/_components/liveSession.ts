import type { Role } from "../../modules/auth/permissions";

/** App chế độ thật dựng cho đúng một người dùng và một vai trò; bộ nhớ tạm sống cùng nó. */
export type LiveBinding<A> = { userId: string; role: Role; app: A; dispose(): void };
/** Phiên hiện tại: `role: null` là đang đọc vai trò từ hồ sơ. */
export type CurrentSession = { userId: string; role: Role | null } | null;

/** Chỉ trả app khi khớp đúng người và đúng vai trò của phiên hiện tại; không bao giờ trả app của tài khoản cũ. */
export function readyLive<L extends LiveBinding<unknown>>(live: L | null, session: CurrentSession): L | null {
  if (!live || !session || session.role === null) return null;
  return live.userId === session.userId && live.role === session.role ? live : null;
}

/**
 * Phiên đổi (đăng xuất, hết hạn, đổi tài khoản, đổi vai trò) → xóa bộ nhớ tạm ngay và bỏ app cũ.
 * Cùng người, vai trò chưa đọc xong (ví dụ vừa làm mới token) thì giữ nguyên.
 */
export function reconcileLive<L extends LiveBinding<unknown>>(live: L | null, session: CurrentSession): L | null {
  if (!live) return null;
  const sameUser = session !== null && session.userId === live.userId;
  const sameRole = session !== null && (session.role === null || session.role === live.role);
  if (sameUser && sameRole) return live;
  live.dispose();
  return null;
}
