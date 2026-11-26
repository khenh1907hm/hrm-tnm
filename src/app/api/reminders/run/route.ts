import { createClient } from "@supabase/supabase-js";
import { handleReminderRequest, type ReminderDeps } from "../../../../lib/reminderRunner";
import { reminderEnv, serverHrApp } from "../../../../lib/serverHrApp";

// Gửi email qua SMTP và tin Telegram cho từng nơi nhận, có thể mất một lúc
export const maxDuration = 60;

function buildDeps(): ReminderDeps {
  const server = serverHrApp();
  const app = server.app;
  return {
    lookupRole: server.lookupRole,
    lookupPermissions: server.lookupPermissions,
    runReminders: app && server.hasMailer ? (actor) => app.reminders.run(actor) : null,
    // Bản tin hằng ngày chạy được khi có ít nhất một kênh (SMTP hoặc bot Telegram)
    runDigest: app && (server.hasMailer || server.hasTelegram) ? (actor) => app.notifications.runDailyDigest(actor) : null,
  };
}

/**
 * Nhắc ngày giao hàng: tạo thông báo cho người lập đơn (còn 3 ngày, 1 ngày, đúng ngày, quá hẹn) rồi gửi email ngay.
 * Chỉ chạy khi lịch chạy gọi bằng CRON_SECRET.
 */
async function runDeliveryReminders(request: Request): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !url || !key || request.headers.get("authorization") !== `Bearer ${secret}`) return;
  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await admin.rpc("purchase_delivery_reminders");
    if (Number(data) > 0) await fetch(new URL("/api/notifications/approvals", request.url), { headers: { authorization: `Bearer ${secret}` } }).catch(() => undefined);
  } catch { /* không làm hỏng nhắc hạn chứng chỉ */ }
}

/** Lịch chạy (Vercel Cron, cron trên VPS) gọi bằng GET kèm `Authorization: Bearer CRON_SECRET`: nhắc hạn + bản tin hằng ngày + nhắc ngày giao hàng. */
export async function GET(request: Request) {
  const response = await handleReminderRequest(request, reminderEnv(), buildDeps());
  await runDeliveryReminders(request);
  return response;
}

/** Admin bấm "Gửi email nhắc hạn" trong app, kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleReminderRequest(request, reminderEnv(), buildDeps());
}
