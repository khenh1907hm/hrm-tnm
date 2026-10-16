import { describe, expect, it, vi } from "vitest";
import { success } from "./result";
import { CRON_ACTOR, handleReminderRequest, type ReminderDeps } from "./reminderRunner";

const env = { cronSecret: "cron-secret", supabaseUrl: "https://example.supabase.co", supabaseKey: "publishable" };
const request = (authorization?: string) => new Request("http://localhost/api/reminders/run", { method: "POST", headers: authorization ? { authorization } : {} });
const userFetch = (id: string | null) => vi.fn(async () => id ? new Response(JSON.stringify({ id }), { status: 200 }) : new Response("{}", { status: 401 })) as unknown as typeof fetch;
const runResult = success({ sent: ["c1"], failed: [], skipped: [] });

function deps(overrides: Partial<ReminderDeps> = {}): ReminderDeps {
  return { lookupRole: async () => "admin", runReminders: vi.fn(async () => runResult), fetcher: userFetch("u1"), ...overrides };
}

describe("handleReminderRequest", () => {
  it("chạy với tác nhân hệ thống khi đúng CRON_SECRET", async () => {
    const d = deps();
    const response = await handleReminderRequest(request("Bearer cron-secret"), env, d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sent: ["c1"], failed: [], skipped: [] });
    expect(d.runReminders).toHaveBeenCalledWith(CRON_ACTOR);
    expect(d.fetcher).not.toHaveBeenCalled();
  });

  it("từ chối khi không có token", async () => {
    const response = await handleReminderRequest(request(), env, deps());
    expect(response.status).toBe(401);
  });

  it("từ chối token sai và token người dùng không hợp lệ", async () => {
    const response = await handleReminderRequest(request("Bearer wrong"), env, deps({ fetcher: userFetch(null) }));
    expect(response.status).toBe(401);
  });

  it("cho Admin đã đăng nhập chạy, ghi đúng id người bấm", async () => {
    const d = deps();
    const response = await handleReminderRequest(request("Bearer user-jwt"), env, d);
    expect(response.status).toBe(200);
    expect(d.runReminders).toHaveBeenCalledWith({ id: "u1", role: "admin" });
  });

  it("chặn HR và tài khoản chưa cấp quyền", async () => {
    for (const role of ["hr", "pending", null]) {
      const d = deps({ lookupRole: async () => role });
      const response = await handleReminderRequest(request("Bearer user-jwt"), env, d);
      expect(response.status).toBe(401);
      expect(d.runReminders).not.toHaveBeenCalled();
    }
  });

  it("không nhận CRON_SECRET rỗng làm mật khẩu", async () => {
    const response = await handleReminderRequest(request("Bearer "), { ...env, cronSecret: "" }, deps({ fetcher: userFetch(null) }));
    expect(response.status).toBe(401);
  });

  it("báo 503 khi máy chủ chưa cấu hình SMTP hoặc khóa bí mật", async () => {
    const response = await handleReminderRequest(request("Bearer cron-secret"), env, deps({ runReminders: null }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("REMINDER_NOT_CONFIGURED");
  });
});
