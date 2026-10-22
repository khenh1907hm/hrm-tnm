import { describe, expect, it, vi } from "vitest";
import { reconcileLive, readyLive, type LiveBinding } from "./liveSession";

const binding = (userId: string, role: "admin" | "hr" = "admin"): LiveBinding<string> & { dispose: ReturnType<typeof vi.fn> } => ({ userId, role, app: `app-${userId}`, dispose: vi.fn() });

describe("18. bộ nhớ tạm gắn với tài khoản", () => {
  it("đổi tài khoản: không bao giờ trả app (và cache) của tài khoản cũ, và xóa nó ngay", () => {
    const live = binding("user-a");
    expect(readyLive(live, { userId: "user-b", role: "admin" })).toBeNull();
    expect(reconcileLive(live, { userId: "user-b", role: "admin" })).toBeNull();
    expect(live.dispose).toHaveBeenCalledTimes(1);
  });

  it("phiên hết hạn hoặc đăng xuất ở tab khác (không còn phiên) cũng xóa", () => {
    const live = binding("user-a");
    expect(readyLive(live, null)).toBeNull();
    expect(reconcileLive(live, null)).toBeNull();
    expect(live.dispose).toHaveBeenCalledTimes(1);
  });

  it("đổi vai trò cũng xóa; cùng người cùng vai trò (làm mới token) thì giữ nguyên", () => {
    const live = binding("user-a", "admin");
    expect(reconcileLive(live, { userId: "user-a", role: "admin" })).toBe(live);
    expect(readyLive(live, { userId: "user-a", role: "admin" })).toBe(live);
    expect(live.dispose).not.toHaveBeenCalled();
    expect(readyLive(live, { userId: "user-a", role: "hr" })).toBeNull();
    expect(reconcileLive(live, { userId: "user-a", role: "hr" })).toBeNull();
    expect(live.dispose).toHaveBeenCalledTimes(1);
  });

  it("chưa xác định vai trò (đang đọc hồ sơ) thì chưa sẵn sàng nhưng không xóa nhầm khi cùng người", () => {
    const live = binding("user-a");
    expect(readyLive(live, { userId: "user-a", role: null })).toBeNull();
    expect(reconcileLive(live, { userId: "user-a", role: null })).toBe(live);
    expect(readyLive(null, { userId: "user-a", role: "admin" })).toBeNull();
  });
});
