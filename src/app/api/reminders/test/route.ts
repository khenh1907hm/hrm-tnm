import { createClient } from "@supabase/supabase-js";
import { createHrApp } from "../../../../app-core/createHrApp";
import { systemClock } from "../../../../lib/clock";
import { randomIds } from "../../../../lib/ids";
import { createSmtpMailer } from "../../../../lib/mailer/smtpMailer";
import { handleReminderTestRequest, type ReminderDeps } from "../../../../lib/reminderRunner";
import { createSupabaseRepositories } from "../../../../repositories/supabase/createSupabaseRepositories";

export const maxDuration = 30;

function buildDeps(): ReminderDeps {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  // Khóa bí mật bỏ qua RLS: chỉ dùng ở máy chủ, sau khi đã xác thực người gọi là Admin
  const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const mailer = createSmtpMailer({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM });
  const appUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  return {
    lookupRole: async (userId) => {
      if (!admin) return null;
      const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      return data?.role ?? null;
    },
    runReminders: null,
    sendTest: admin && mailer
      ? (actor) => createHrApp({ clock: systemClock, ids: randomIds(), repositories: createSupabaseRepositories(admin), mailer, profileBaseUrl: `${appUrl}/nhan-su/` }).reminders.sendTest(actor)
      : null,
  };
}

/** Admin bấm "Gửi email thử" trong Cài đặt email, kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleReminderTestRequest(request, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, buildDeps());
}
