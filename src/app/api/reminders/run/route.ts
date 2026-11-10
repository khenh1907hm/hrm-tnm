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

/** Lịch chạy (Vercel Cron, cron trên VPS) gọi bằng GET kèm `Authorization: Bearer CRON_SECRET`: nhắc hạn + bản tin hằng ngày. */
export async function GET(request: Request) {
  return handleReminderRequest(request, reminderEnv(), buildDeps());
}

/** Admin bấm "Gửi email nhắc hạn" trong app, kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleReminderRequest(request, reminderEnv(), buildDeps());
}
