import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { handleReminderTestRequest } from "../lib/reminderRunner";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "actor-admin", role: "admin" as const };
const hr = { id: "actor-hr", role: "hr" as const };
const clock = fixedClock("2026-10-12T09:00:00+07:00");

async function setup(mailer?: { send: (message: { to: string[]; subject: string; text: string }) => Promise<void> }) {
  const repositories = await createDemoRepositories(clock, sequentialIds("seed"));
  return createHrApp({ clock, ids: sequentialIds("case"), repositories, ...(mailer ? { mailer } : {}) });
}

describe("gửi thử email nhắc hạn", () => {
  it("REM_07 gửi mẫu nhắc hạn của chứng chỉ hết hạn gần nhất tới địa chỉ đã lưu, không đánh dấu đã gửi", async () => {
    const sent: { to: string[]; subject: string; text: string }[] = [];
    const app = await setup({ send: async (message) => { sent.push(message); } });
    expect(await app.reminders.sendTest(admin)).toMatchObject({ ok: false, errors: [{ code: "NO_RECIPIENT" }] });
    await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, expectedVersion: 0 });
    const dueBefore = await app.reminders.computeDue(admin);

    const result = await app.reminders.sendTest(admin);
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["hr@example.test"]);
    expect(sent[0]!.subject).toMatch(/^\[Gửi thử\] Nhắc hạn chứng chỉ: \d+ chứng chỉ cần gia hạn/);
    expect(result.ok && result.value.count).toBeGreaterThan(1);
    expect(sent[0]!.text).toContain("GỬI THỬ");
    // Lịch nhắc thật không đổi: các chứng chỉ đến hạn vẫn còn chờ gửi
    expect(await app.reminders.computeDue(admin)).toEqual(dueBefore);
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.some((event) => event.action === "reminder.test")).toBe(true);
    expect((await app.reminders.sendTest(({ id: "outsider", role: "pending" } as never))).ok).toBe(false);
  });

  it("REM_06 mỗi lần chạy gửi MỘT email cho mọi chứng chỉ đến hạn, ghi nhận tất cả; lỗi thì không ghi chứng chỉ nào", async () => {
    const sent: { subject: string; html?: string }[] = [];
    const app = await setup({ send: async (message) => { sent.push(message); } });
    await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: true, expectedVersion: 0 });
    const due = await app.reminders.computeDue(admin);
    const count = due.ok ? due.value.length : 0;
    expect(count).toBeGreaterThan(1);
    const run = await app.reminders.run(admin);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain(`${count} chứng chỉ cần gia hạn`);
    expect(run.ok && run.value.sent).toHaveLength(count);
    expect(await app.reminders.computeDue(admin)).toMatchObject({ ok: true, value: [] });

    const broken = await setup({ send: async () => { throw new Error("down"); } });
    await broken.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: true, expectedVersion: 0 });
    const failed = await broken.reminders.run(admin);
    expect(failed.ok && failed.value.failed).toHaveLength(count);
    expect((await broken.reminders.computeDue(admin))).toMatchObject({ ok: true, value: { length: count } });
  });

  it("REM_07 báo lỗi rõ khi chưa cấu hình máy chủ email hoặc gửi thất bại", async () => {
    const noMailer = await setup();
    await noMailer.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, expectedVersion: 0 });
    expect(await noMailer.reminders.sendTest(admin)).toMatchObject({ ok: false, errors: [{ code: "REMINDER_NOT_CONFIGURED" }] });
    const broken = await setup({ send: async () => { throw new Error("535 auth failed"); } });
    await broken.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, expectedVersion: 0 });
    expect(await broken.reminders.sendTest(admin)).toMatchObject({ ok: false, errors: [{ code: "MAIL_TEST_FAILED" }] });
  });

  it("REM_07 API nhận token Admin hoặc HR, không nhận CRON_SECRET hay tài khoản chưa cấp quyền", async () => {
    const env = { cronSecret: "cron-secret", supabaseUrl: "https://example.supabase.co", supabaseKey: "publishable" };
    const fetcher = (async () => new Response(JSON.stringify({ id: "u1" }), { status: 200 })) as unknown as typeof fetch;
    const request = (authorization: string) => new Request("http://localhost/api/reminders/test", { method: "POST", headers: { authorization } });
    const sendTest = async () => ({ ok: true as const, value: { to: ["hr@example.test"], subject: "[Gửi thử] x", count: 1 }, warnings: [] });
    expect((await handleReminderTestRequest(request("Bearer cron-secret"), env, { lookupRole: async () => null, runReminders: null, sendTest, fetcher })).status).toBe(401);
    expect((await handleReminderTestRequest(request("Bearer jwt"), env, { lookupRole: async () => "hr", runReminders: null, sendTest, fetcher })).status).toBe(200);
    expect((await handleReminderTestRequest(request("Bearer jwt"), env, { lookupRole: async () => "pending", runReminders: null, sendTest, fetcher })).status).toBe(401);
    expect((await handleReminderTestRequest(request("Bearer jwt"), env, { lookupRole: async () => "admin", runReminders: null, sendTest: null, fetcher })).status).toBe(503);
    const ok = await handleReminderTestRequest(request("Bearer jwt"), env, { lookupRole: async () => "admin", runReminders: null, sendTest, fetcher });
    expect(await ok.json()).toEqual({ ok: true, to: ["hr@example.test"], subject: "[Gửi thử] x", count: 1 });
  });
});
