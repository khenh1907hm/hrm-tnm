import { handleReminderTestRequest, type ReminderDeps } from "../../../../lib/reminderRunner";
import { reminderEnv, serverHrApp } from "../../../../lib/serverHrApp";

export const maxDuration = 30;

function buildDeps(): ReminderDeps {
  const server = serverHrApp();
  const app = server.app;
  return {
    lookupRole: server.lookupRole,
    lookupPermissions: server.lookupPermissions,
    runReminders: null,
    sendTest: app && server.hasMailer ? (actor) => app.reminders.sendTest(actor) : null,
  };
}

/** Admin bấm "Gửi email thử" trong Cài đặt email, kèm token đăng nhập. */
export async function POST(request: Request) {
  return handleReminderTestRequest(request, reminderEnv(), buildDeps());
}
