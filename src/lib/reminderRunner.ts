import type { DigestRunResult, ReminderRunResult, TelegramTestResult } from "../app-core/createHrApp";
import type { ReminderTestResult } from "../app-core/use-cases/reminders";
import { messagesVi } from "../messages.vi";
import type { Result } from "./result";
import { actorFromProfile, can, type Actor } from "../modules/auth/permissions";

type Fetch = typeof fetch;

export type ReminderEnv = { cronSecret?: string | undefined; supabaseUrl?: string | undefined; supabaseKey?: string | undefined };
export type ReminderDeps = {
  /** Vai trò trong bảng profiles của người dùng; null nếu không có. */
  lookupRole: (userId: string) => Promise<string | null>;
  /** Các mục quyền Admin đã tick riêng; không truyền hoặc null thì theo mặc định của vai trò. */
  lookupPermissions?: (userId: string) => Promise<unknown>;
  /** null khi máy chủ chưa cấu hình đủ (khóa Supabase bí mật hoặc SMTP). */
  runReminders: ((actor: Actor) => Promise<Result<ReminderRunResult>>) | null;
  /** Gửi một email mẫu; null khi máy chủ chưa cấu hình đủ. */
  sendTest?: ((actor: Actor) => Promise<Result<ReminderTestResult>>) | null;
  /** Bản tin chứng chỉ hằng ngày (email + Telegram); chỉ lịch chạy tự động gọi. null khi thiếu khóa bí mật. */
  runDigest?: ((actor: Actor) => Promise<Result<DigestRunResult>>) | null;
  /** Gửi thử bản tin tới một nơi nhận Telegram; null khi thiếu khóa bí mật. */
  sendTelegramTest?: ((actor: Actor, targetId: string) => Promise<Result<TelegramTestResult>>) | null;
  fetcher?: Fetch;
};

/** Tác nhân hệ thống dùng cho lịch chạy tự động (ghi vào nhật ký thao tác). */
export const CRON_ACTOR: Actor = { id: "system:cron", role: "admin" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (status: number, code: string, message: string) => json(status, { ok: false, code, message });

async function resolveActor(request: Request, env: ReminderEnv, deps: ReminderDeps): Promise<Actor | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  if (env.cronSecret && header === `Bearer ${env.cronSecret}`) return CRON_ACTOR;
  if (!env.supabaseUrl || !env.supabaseKey) return null;
  const response = await (deps.fetcher ?? fetch)(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: env.supabaseKey, authorization: header } });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string };
  if (!user.id) return null;
  const role = await deps.lookupRole(user.id);
  const actor = actorFromProfile(user.id, role, await deps.lookupPermissions?.(user.id));
  // Chỉ người có quyền "Cài đặt email và gửi nhắc hạn"
  return actor && can(actor, "reminderRun") ? actor : null;
}

/**
 * Chạy nhắc hạn: lịch chạy (Vercel Cron hoặc cron trên VPS, kèm CRON_SECRET) hoặc Admin bấm nút trong app (token đăng nhập).
 * Lịch chạy còn gửi bản tin chứng chỉ hằng ngày (email + Telegram); người bấm nút chỉ gửi email nhắc hạn.
 */
export async function handleReminderRequest(request: Request, env: ReminderEnv, deps: ReminderDeps): Promise<Response> {
  const actor = await resolveActor(request, env, deps);
  if (!actor) return fail(401, "REMINDER_UNAUTHORIZED", "Chỉ Admin, HR hoặc lịch chạy tự động được gửi nhắc hạn.");
  const runDigest = actor.id === CRON_ACTOR.id ? deps.runDigest ?? null : null;
  if (!deps.runReminders && !runDigest) return fail(503, "REMINDER_NOT_CONFIGURED", "Máy chủ chưa cấu hình gửi email (SUPABASE_SECRET_KEY, SMTP_HOST, SMTP_USER, SMTP_PASS).");
  // Thiếu SMTP vẫn chạy bản tin Telegram; phần email nhắc hạn báo chưa cấu hình
  const result = deps.runReminders ? await deps.runReminders(actor) : null;
  if (result && !result.ok) return fail(403, result.errors[0]?.code ?? "FORBIDDEN", "Không có quyền gửi nhắc hạn.");
  const reminders = result?.ok ? result.value : { sent: [], failed: [], skipped: [], reminderEmail: "REMINDER_NOT_CONFIGURED" };
  if (!runDigest) return json(200, { ok: true, ...reminders });
  const digest = await runDigest(actor);
  return json(200, { ok: true, ...reminders, digest: digest.ok ? digest.value : { code: digest.errors[0]?.code ?? "FORBIDDEN" } });
}

/** Admin bấm "Gửi email thử": gửi một email mẫu tới địa chỉ nhận nhắc hạn, không đánh dấu đã gửi. */
export async function handleReminderTestRequest(request: Request, env: ReminderEnv, deps: ReminderDeps): Promise<Response> {
  const actor = await resolveActor(request, { ...env, cronSecret: undefined }, deps);
  if (!actor) return fail(401, "REMINDER_UNAUTHORIZED", "Chỉ Admin hoặc HR được gửi email thử.");
  if (!deps.sendTest) return fail(503, "REMINDER_NOT_CONFIGURED", "Máy chủ chưa cấu hình gửi email (SUPABASE_SECRET_KEY, SMTP_HOST, SMTP_USER, SMTP_PASS).");
  const result = await deps.sendTest(actor);
  if (!result.ok) {
    const code = result.errors[0]?.code ?? "MAIL_TEST_FAILED";
    return fail(code === "FORBIDDEN" ? 403 : 400, code, messagesVi[code] ?? "Không gửi được email thử.");
  }
  return json(200, { ok: true, ...result.value });
}

/** Admin bấm "Gửi thử" ở một nơi nhận Telegram: gửi bản tin hôm nay kèm ghi chú GỬI THỬ, không ghi nhật ký gửi. */
export async function handleTelegramTestRequest(request: Request, env: ReminderEnv, deps: ReminderDeps): Promise<Response> {
  const actor = await resolveActor(request, { ...env, cronSecret: undefined }, deps);
  if (!actor || actor.role !== "admin") return fail(401, "REMINDER_UNAUTHORIZED", "Chỉ Admin được gửi thử Telegram.");
  if (!deps.sendTelegramTest) return fail(503, "REMINDER_NOT_CONFIGURED", "Máy chủ chưa cấu hình khóa bí mật Supabase (SUPABASE_SECRET_KEY).");
  const body = await request.json().catch(() => null) as { targetId?: unknown } | null;
  if (typeof body?.targetId !== "string" || !body.targetId) return fail(400, "NOTIFY_TARGET_NOT_FOUND", messagesVi.NOTIFY_TARGET_NOT_FOUND ?? "Không tìm thấy nơi nhận.");
  const result = await deps.sendTelegramTest(actor, body.targetId);
  if (!result.ok) {
    const error = result.errors[0];
    const code = error?.code ?? "TELEGRAM_TEST_FAILED";
    const detail = error?.params?.detail ? ` (Telegram: ${error.params.detail})` : "";
    return fail(code === "FORBIDDEN" ? 403 : code === "TELEGRAM_NOT_CONFIGURED" ? 503 : 400, code, `${messagesVi[code] ?? "Không gửi được tin thử."}${detail}`);
  }
  return json(200, { ok: true, ...result.value });
}
