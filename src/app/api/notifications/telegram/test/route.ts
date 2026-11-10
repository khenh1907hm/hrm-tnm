import { handleTelegramTestRequest, type ReminderDeps } from "../../../../../lib/reminderRunner";
import { reminderEnv, serverHrApp } from "../../../../../lib/serverHrApp";

export const maxDuration = 30;

function buildDeps(): ReminderDeps {
  const server = serverHrApp();
  const app = server.app;
  return {
    lookupRole: server.lookupRole,
    lookupPermissions: server.lookupPermissions,
    runReminders: null,
    // Thiếu TELEGRAM_BOT_TOKEN thì use case trả TELEGRAM_NOT_CONFIGURED
    sendTelegramTest: app ? (actor, targetId) => app.notifications.sendTelegramTest(actor, targetId) : null,
  };
}

/** Admin bấm "Gửi thử" ở một nơi nhận Telegram trong Cài đặt, gửi `{ targetId }` kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleTelegramTestRequest(request, reminderEnv(), buildDeps());
}
