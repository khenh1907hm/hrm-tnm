import type { ReminderRunResult } from "../app-core/createHrApp";
import type { Result } from "./result";
import type { Actor } from "../modules/auth/permissions";

type Fetch = typeof fetch;

export type ReminderEnv = { cronSecret?: string | undefined; supabaseUrl?: string | undefined; supabaseKey?: string | undefined };
export type ReminderDeps = {
  /** Vai trò trong bảng profiles của người dùng; null nếu không có. */
  lookupRole: (userId: string) => Promise<string | null>;
  /** null khi máy chủ chưa cấu hình đủ (khóa Supabase bí mật hoặc SMTP). */
  runReminders: ((actor: Actor) => Promise<Result<ReminderRunResult>>) | null;
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
  return role === "admin" ? { id: user.id, role: "admin" } : null;
}

/** Chạy nhắc hạn: lịch Vercel Cron (CRON_SECRET) hoặc Admin bấm nút trong app (token đăng nhập). */
export async function handleReminderRequest(request: Request, env: ReminderEnv, deps: ReminderDeps): Promise<Response> {
  const actor = await resolveActor(request, env, deps);
  if (!actor) return fail(401, "REMINDER_UNAUTHORIZED", "Chỉ Admin hoặc lịch chạy tự động được gửi nhắc hạn.");
  if (!deps.runReminders) return fail(503, "REMINDER_NOT_CONFIGURED", "Máy chủ chưa cấu hình gửi email (SUPABASE_SECRET_KEY, SMTP_HOST, SMTP_USER, SMTP_PASS).");
  const result = await deps.runReminders(actor);
  if (!result.ok) return fail(403, result.errors[0]?.code ?? "FORBIDDEN", "Không có quyền gửi nhắc hạn.");
  return json(200, { ok: true, ...result.value });
}
