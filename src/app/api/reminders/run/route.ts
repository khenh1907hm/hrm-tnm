import { createClient } from "@supabase/supabase-js";
import { createHrApp } from "../../../../app-core/createHrApp";
import { systemClock } from "../../../../lib/clock";
import { randomIds } from "../../../../lib/ids";
import { createSmtpMailer } from "../../../../lib/mailer/smtpMailer";
import { handleReminderRequest, type ReminderDeps } from "../../../../lib/reminderRunner";
import { createSupabaseRepositories } from "../../../../repositories/supabase/createSupabaseRepositories";

// Gửi tuần tự từng email qua SMTP, vài chục email có thể mất một lúc
export const maxDuration = 60;

function buildDeps(): ReminderDeps {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  // Khóa bí mật bỏ qua RLS: chỉ dùng ở máy chủ, sau khi đã xác thực người gọi
  const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const mailer = createSmtpMailer({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM });
  const appUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  return {
    lookupRole: async (userId) => {
      if (!admin) return null;
      const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      return data?.role ?? null;
    },
    runReminders: admin && mailer
      ? (actor) => createHrApp({ clock: systemClock, ids: randomIds(), repositories: createSupabaseRepositories(admin), mailer, profileBaseUrl: `${appUrl}/#nhan-su/` }).reminders.run(actor)
      : null,
  };
}

const env = () => ({ cronSecret: process.env.CRON_SECRET, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });

/** Vercel Cron gọi bằng GET kèm `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  return handleReminderRequest(request, env(), buildDeps());
}

/** Admin bấm "Gửi email nhắc hạn" trong app, kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleReminderRequest(request, env(), buildDeps());
}
