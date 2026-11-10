import { describe, expect, it, vi } from "vitest";
import { success } from "./result";
import { CRON_ACTOR, handleReminderRequest, handleTelegramTestRequest, type ReminderDeps } from "./reminderRunner";

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

  it("theo mục quyền đã tick: Kỹ sư được cấp thì chạy được, HR bị bỏ tick thì không", async () => {
    const engineer = deps({ lookupRole: async () => "engineer", lookupPermissions: async () => ["reminders.manage"] });
    expect((await handleReminderRequest(request("Bearer user-jwt"), env, engineer)).status).toBe(200);
    const hr = deps({ lookupRole: async () => "hr", lookupPermissions: async () => ["employees.view"] });
    expect((await handleReminderRequest(request("Bearer user-jwt"), env, hr)).status).toBe(401);
    expect(hr.runReminders).not.toHaveBeenCalled();
  });

  it("cho HR chạy nhắc hạn, chặn tài khoản chưa cấp quyền", async () => {
    const asHr = deps({ lookupRole: async () => "hr" });
    expect((await handleReminderRequest(request("Bearer user-jwt"), env, asHr)).status).toBe(200);
    expect(asHr.runReminders).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", role: "hr" }));
    for (const role of ["pending", "employee", null]) {
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

  it("NOTI_05 chỉ lịch chạy (CRON_SECRET) gửi bản tin hằng ngày; Admin bấm nút chỉ gửi email nhắc hạn; thiếu SMTP vẫn chạy bản tin", async () => {
    const digestValue = { date: "2026-11-10", total: 2, expired: 1, expiring: 1, deliveries: [] };
    const digest = success(digestValue);
    const d = deps({ runDigest: vi.fn(async () => digest) });
    const cron = await handleReminderRequest(request("Bearer cron-secret"), env, d);
    expect(await cron.json()).toEqual({ ok: true, sent: ["c1"], failed: [], skipped: [], digest: digestValue });
    expect(d.runDigest).toHaveBeenCalledWith(CRON_ACTOR);
    const byAdmin = deps({ runDigest: vi.fn(async () => digest) });
    expect(await (await handleReminderRequest(request("Bearer user-jwt"), env, byAdmin)).json()).toEqual({ ok: true, sent: ["c1"], failed: [], skipped: [] });
    expect(byAdmin.runDigest).not.toHaveBeenCalled();
    const noSmtp = await handleReminderRequest(request("Bearer cron-secret"), env, deps({ runReminders: null, runDigest: async () => digest }));
    expect(noSmtp.status).toBe(200);
    expect(await noSmtp.json()).toMatchObject({ ok: true, sent: [], reminderEmail: "REMINDER_NOT_CONFIGURED", digest: { total: 2 } });
  });

  it("NOTI_05 gửi thử Telegram: chỉ Admin đăng nhập, không nhận CRON_SECRET, báo mô tả lỗi của Telegram", async () => {
    const post = (authorization: string, body: unknown) => new Request("http://localhost/api/notifications/telegram/test", { method: "POST", headers: { authorization }, body: JSON.stringify(body) });
    const sendTelegramTest = vi.fn(async () => success({ name: "Nhóm A", count: 3 }));
    expect((await handleTelegramTestRequest(post("Bearer cron-secret", { targetId: "t1" }), env, deps({ sendTelegramTest, fetcher: userFetch(null) }))).status).toBe(401);
    expect((await handleTelegramTestRequest(post("Bearer user-jwt", { targetId: "t1" }), env, deps({ sendTelegramTest, lookupRole: async () => "hr" }))).status).toBe(401);
    const ok = await handleTelegramTestRequest(post("Bearer user-jwt", { targetId: "t1" }), env, deps({ sendTelegramTest }));
    expect(await ok.json()).toEqual({ ok: true, name: "Nhóm A", count: 3 });
    expect(sendTelegramTest).toHaveBeenCalledWith({ id: "u1", role: "admin" }, "t1");
    expect((await handleTelegramTestRequest(post("Bearer user-jwt", {}), env, deps({ sendTelegramTest }))).status).toBe(400);
    const failing = deps({ sendTelegramTest: async () => ({ ok: false as const, errors: [{ code: "TELEGRAM_TEST_FAILED", severity: "error" as const, params: { detail: "Bad Request: chat not found" } }], warnings: [] }) });
    const failed = await handleTelegramTestRequest(post("Bearer user-jwt", { targetId: "t1" }), env, failing);
    expect(failed.status).toBe(400);
    expect((await failed.json()).message).toContain("(Telegram: Bad Request: chat not found)");
  });
});
