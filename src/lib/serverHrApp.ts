import { createClient } from "@supabase/supabase-js";
import { createHrApp } from "../app-core/createHrApp";
import { systemClock } from "./clock";
import { randomIds } from "./ids";
import { createSmtpMailer } from "./mailer/smtpMailer";
import { createTelegramSender } from "./notify/telegram";
import type { ReminderEnv } from "./reminderRunner";
import { createSupabaseRepositories } from "../repositories/supabase/createSupabaseRepositories";

/**
 * Dựng app ở máy chủ cho các API nhắc hạn / thông báo: client Supabase khóa bí mật (bỏ qua RLS, chỉ dùng sau khi
 * đã xác thực người gọi), mailer SMTP và bot Telegram lấy từ biến môi trường. Thiếu khóa bí mật thì `app` là null.
 */
export function serverHrApp() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const mailer = createSmtpMailer({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM });
  const telegram = createTelegramSender(process.env.TELEGRAM_BOT_TOKEN);
  const appUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const app = admin
    ? createHrApp({
      clock: systemClock, ids: randomIds(), repositories: createSupabaseRepositories(admin), profileBaseUrl: `${appUrl}/nhan-su/`,
      ...(mailer ? { mailer } : {}), ...(telegram ? { telegram } : {}), ...(appUrl ? { appBaseUrl: appUrl } : {}),
    })
    : null;
  return {
    app, hasMailer: mailer !== null, hasTelegram: telegram !== null,
    lookupRole: async (userId: string) => {
      if (!admin) return null;
      const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      return (data?.role as string | undefined) ?? null;
    },
    lookupPermissions: async (userId: string) => {
      if (!admin) return null;
      const { data } = await admin.from("profiles").select("permissions").eq("id", userId).maybeSingle();
      return data?.permissions ?? null;
    },
  };
}

export const reminderEnv = (): ReminderEnv => ({ cronSecret: process.env.CRON_SECRET, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
