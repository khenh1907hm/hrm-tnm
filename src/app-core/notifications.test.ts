import { describe, expect, it, vi } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createTelegramSender } from "../lib/notify/telegram";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createFakeSupabase } from "../repositories/supabase/fakeSupabase";
import { SupabaseNotificationLogRepository } from "../repositories/supabase/createSupabaseRepositories";
import { createHrApp } from "./createHrApp";
import type { Mailer, TelegramSender } from "./context";

const admin = { id: "actor-admin", role: "admin" as const };
const hr = { id: "actor-hr", role: "hr" as const };
const cron = { id: "system:cron", role: "admin" as const };

async function setup(options: { mailer?: Mailer; telegram?: TelegramSender; clock?: string } = {}) {
  const clock = fixedClock(options.clock ?? "2026-10-12T08:00:00+07:00");
  const repositories = await createDemoRepositories(clock, sequentialIds("seed"));
  const app = createHrApp({ clock, ids: sequentialIds("case"), repositories, appBaseUrl: "https://tnm.com.vn", ...(options.mailer ? { mailer: options.mailer } : {}), ...(options.telegram ? { telegram: options.telegram } : {}) });
  return { app, repositories };
}
const fakeTelegram = () => {
  const sent: { chatId: string; text: string }[] = [];
  let failFor: string | null = null;
  return { sent, failOn: (chatId: string | null) => { failFor = chatId; }, sender: { send: async (chatId: string, text: string) => { if (chatId === failFor) throw new Error("Bad Request: chat not found"); sent.push({ chatId, text }); } } };
};

describe("thông báo: nơi nhận Telegram và bản tin hằng ngày", () => {
  it("NOTI_04 chỉ Admin thêm, sửa, xóa nơi nhận; kiểm tra tên, Chat ID, trùng", async () => {
    const { app } = await setup();
    expect((await app.notifications.listTargets(hr)).ok).toBe(false);
    expect((await app.notifications.saveTarget(hr, { name: "Nhóm HSE", chatId: "-1001234567890", enabled: true })).ok).toBe(false);
    expect(await app.notifications.saveTarget(admin, { name: " ", chatId: "-1001234567890", enabled: true })).toMatchObject({ ok: false, errors: [{ code: "NOTIFY_NAME_INVALID" }] });
    expect(await app.notifications.saveTarget(admin, { name: "Nhóm", chatId: "abc", enabled: true })).toMatchObject({ ok: false, errors: [{ code: "NOTIFY_CHAT_ID_INVALID" }] });

    const created = await app.notifications.saveTarget(admin, { name: " Nhóm HSE ", chatId: " -1001234567890 ", enabled: true });
    expect(created).toMatchObject({ ok: true, value: { name: "Nhóm HSE", chatId: "-1001234567890", channel: "telegram", topics: ["certificate_digest"], version: 1 } });
    expect(await app.notifications.saveTarget(admin, { name: "Khác", chatId: "-1001234567890", enabled: true })).toMatchObject({ ok: false, errors: [{ code: "NOTIFY_CHAT_ID_DUPLICATE" }] });
    expect((await app.notifications.saveTarget(admin, { name: "Kênh", chatId: "@tnm_hse_channel", enabled: false })).ok).toBe(true);

    const target = created.ok ? created.value : null;
    const updated = await app.notifications.saveTarget(admin, { id: target!.id, expectedVersion: 1, name: "Nhóm HSE 2", chatId: target!.chatId, enabled: false });
    expect(updated).toMatchObject({ ok: true, value: { name: "Nhóm HSE 2", enabled: false, version: 2 } });
    expect(await app.notifications.saveTarget(admin, { id: target!.id, expectedVersion: 1, name: "Cũ", chatId: target!.chatId, enabled: true })).toMatchObject({ ok: false, errors: [{ code: "CONFLICT" }] });
    expect((await app.notifications.removeTarget(admin, target!.id)).ok).toBe(true);
    expect((await app.notifications.listTargets(admin)).ok && (await app.notifications.listTargets(admin))).toMatchObject({ value: [{ name: "Kênh" }] });
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.map((event) => event.action).filter((action) => action.startsWith("notificationTarget."))).toEqual(["notificationTarget.create", "notificationTarget.create", "notificationTarget.update", "notificationTarget.remove"]);
  });

  it("NOTI_03 bản tin gửi email và từng nhóm Telegram đang bật đúng một lần mỗi ngày; ngày mới gửi lại", async () => {
    const mails: { to: string[]; subject: string; text: string; html?: string }[] = [];
    const telegram = fakeTelegram();
    const { app, repositories } = await setup({ mailer: { send: async (message) => { mails.push(message); } }, telegram: telegram.sender });
    await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, expectedVersion: 0 });
    await app.notifications.saveTarget(admin, { name: "Nhóm A", chatId: "-1001", enabled: true });
    await app.notifications.saveTarget(admin, { name: "Nhóm tắt", chatId: "-1002", enabled: false });
    await app.notifications.saveTarget(admin, { name: "Nhóm B", chatId: "@nhom_b_tnm", enabled: true });

    const first = await app.notifications.runDailyDigest(cron);
    expect(first.ok).toBe(true);
    const value = first.ok ? first.value : null;
    expect(value!.total).toBeGreaterThan(0);
    expect(value!.deliveries.map((item) => [item.channel, item.name, item.status])).toEqual([["email", "hr@example.test", "sent"], ["telegram", "Nhóm A", "sent"], ["telegram", "Nhóm B", "sent"]]);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toMatch(/^Bản tin chứng chỉ \d+ cần gia hạn .*· 12\/10\/2026$/);
    expect(mails[0]!.html).toContain("Bản tin chứng chỉ · 12/10/2026");
    expect(telegram.sent.map((item) => item.chatId)).toEqual(["-1001", "@nhom_b_tnm"]);
    expect(telegram.sent[0]!.text).toContain(`Tổng: <b>${value!.total}</b>`);

    // Chạy lại cùng ngày (cron gọi hai lần, hoặc cả Vercel và VPS cùng gọi): không gửi trùng
    const again = await app.notifications.runDailyDigest(cron);
    expect(again.ok && again.value.deliveries.every((item) => item.status === "already_sent")).toBe(true);
    expect(mails).toHaveLength(1);
    expect(telegram.sent).toHaveLength(2);

    // Ngày hôm sau: gửi lại (dùng chung kho nhưng đồng hồ mới)
    const nextDay = createHrApp({ clock: fixedClock("2026-10-13T08:00:00+07:00"), ids: sequentialIds("next"), repositories, mailer: { send: async (message) => { mails.push(message); } }, telegram: telegram.sender });
    const next = await nextDay.notifications.runDailyDigest(cron);
    expect(next.ok && next.value.deliveries.map((item) => item.status)).toEqual(["sent", "sent", "sent"]);
    expect(mails).toHaveLength(2);
    expect(telegram.sent).toHaveLength(4);
  });

  it("NOTI_03 lỗi ở một nhóm không chặn nhóm khác và không ghi nhật ký, lần chạy sau thử lại đúng nhóm lỗi", async () => {
    const telegram = fakeTelegram();
    const { app } = await setup({ telegram: telegram.sender });
    await app.notifications.saveTarget(admin, { name: "Nhóm A", chatId: "-1001", enabled: true });
    await app.notifications.saveTarget(admin, { name: "Nhóm B", chatId: "-1002", enabled: true });
    telegram.failOn("-1001");
    const first = await app.notifications.runDailyDigest(cron);
    expect(first.ok && first.value.deliveries.map((item) => [item.name, item.status, item.code])).toEqual([
      ["Email", "skipped", "NO_RECIPIENT"],
      ["Nhóm A", "failed", "TELEGRAM_SEND_FAILED"],
      ["Nhóm B", "sent", undefined],
    ]);
    telegram.failOn(null);
    const retry = await app.notifications.runDailyDigest(cron);
    expect(retry.ok && retry.value.deliveries.filter((item) => item.channel === "telegram").map((item) => [item.name, item.status])).toEqual([["Nhóm A", "sent"], ["Nhóm B", "already_sent"]]);
    expect(telegram.sent.map((item) => item.chatId)).toEqual(["-1002", "-1001"]);
  });

  it("NOTI_03 bỏ qua kênh chưa cấu hình hoặc đã tắt, không ghi nhật ký; HR không có quyền bị chặn", async () => {
    const mails: unknown[] = [];
    const { app } = await setup({ mailer: { send: async (message) => { mails.push(message); } } });
    await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, dailyDigestEmail: false, expectedVersion: 0 });
    await app.notifications.saveTarget(admin, { name: "Nhóm A", chatId: "-1001", enabled: true });
    const result = await app.notifications.runDailyDigest(cron);
    expect(result.ok && result.value.deliveries.map((item) => [item.channel, item.status, item.code])).toEqual([["email", "skipped", "DIGEST_EMAIL_DISABLED"], ["telegram", "skipped", "TELEGRAM_NOT_CONFIGURED"]]);
    expect(mails).toHaveLength(0);
    await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, dailyDigestEmail: true, expectedVersion: 1 });
    // Đã bỏ qua lúc trước nên bật lại trong ngày vẫn gửi được
    const enabled = await app.notifications.runDailyDigest(cron);
    expect(enabled.ok && enabled.value.deliveries[0]!.status).toBe("sent");
    expect((await app.notifications.runDailyDigest({ id: "x", role: "hr", access: ["employees.view"] })).ok).toBe(false);
  });

  it("NOTI_05 gửi thử tới một nơi nhận: có ghi chú GỬI THỬ, không ghi nhật ký nên bản tin thật vẫn gửi; báo lỗi kèm mô tả của Telegram", async () => {
    const telegram = fakeTelegram();
    const { app } = await setup({ telegram: telegram.sender });
    const created = await app.notifications.saveTarget(admin, { name: "Nhóm A", chatId: "-1001", enabled: true });
    const id = created.ok ? created.value.id : "";
    expect((await app.notifications.sendTelegramTest(hr, id)).ok).toBe(false);
    expect(await app.notifications.sendTelegramTest(admin, "missing")).toMatchObject({ ok: false, errors: [{ code: "NOTIFY_TARGET_NOT_FOUND" }] });

    const test = await app.notifications.sendTelegramTest(admin, id);
    expect(test).toMatchObject({ ok: true, value: { name: "Nhóm A" } });
    expect(telegram.sent[0]!.text).toMatch(/^<i>GỬI THỬ/);
    const real = await app.notifications.runDailyDigest(cron);
    expect(real.ok && real.value.deliveries.find((item) => item.channel === "telegram")!.status).toBe("sent");

    telegram.failOn("-1001");
    expect(await app.notifications.sendTelegramTest(admin, id)).toMatchObject({ ok: false, errors: [{ code: "TELEGRAM_TEST_FAILED", params: { detail: "Bad Request: chat not found" } }] });
    const { app: unconfigured } = await setup();
    const other = await unconfigured.notifications.saveTarget(admin, { name: "Nhóm", chatId: "-1003", enabled: true });
    expect(await unconfigured.notifications.sendTelegramTest(admin, other.ok ? other.value.id : "")).toMatchObject({ ok: false, errors: [{ code: "TELEGRAM_NOT_CONFIGURED" }] });
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.some((event) => event.action === "notification.test")).toBe(true);
  });

  it("NOTI_04 bot Telegram: không có token thì không tạo; lỗi trả mô tả của Telegram, không lộ token", async () => {
    expect(createTelegramSender(undefined)).toBeNull();
    expect(createTelegramSender("  ")).toBeNull();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })) as unknown as typeof fetch;
    const sender = createTelegramSender("123:SECRET", fetcher)!;
    await expect(sender.send("-1001", "xin chào")).rejects.toThrow("Bad Request: chat not found");
    const [url, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:SECRET/sendMessage");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "-1001", text: "xin chào", parse_mode: "HTML" });
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("SECRET");
    const ok = createTelegramSender("123:SECRET", (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch)!;
    await expect(ok.send("-1001", "x")).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it("NOTI_03 hai lần chạy cùng lúc (Vercel và VPS) chỉ gửi một lần nhờ giữ chỗ trước khi gửi", async () => {
    const telegram = fakeTelegram();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = { send: async (chatId: string, text: string) => { await gate; await telegram.sender.send(chatId, text); } };
    const { app } = await setup({ telegram: slow });
    await app.notifications.saveTarget(admin, { name: "Nhóm A", chatId: "-1001", enabled: true });
    const first = app.notifications.runDailyDigest(cron);
    const second = app.notifications.runDailyDigest(cron);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const statuses = (await Promise.all([first, second])).map((result) => result.ok && result.value.deliveries.find((item) => item.channel === "telegram")!.status).sort();
    expect(statuses).toEqual(["already_sent", "sent"]);
    expect(telegram.sent).toHaveLength(1);
  });

  it("NOTI_03 kho Supabase: giữ chỗ trả false khi trùng khóa, bỏ giữ chỗ thì giữ lại được", async () => {
    const { client } = createFakeSupabase({ notification_log: [] });
    const log = new SupabaseNotificationLogRepository(client);
    const entry = { identity: "certificate_digest|2026-11-10|email", topic: "certificate_digest" as const, channel: "email" as const, targetId: null, sentOn: "2026-11-10" };
    expect(await log.claim(entry)).toBe(true);
    expect(await log.claim(entry)).toBe(false);
    await log.release(entry.identity);
    expect(await log.claim(entry)).toBe(true);
  });
});
