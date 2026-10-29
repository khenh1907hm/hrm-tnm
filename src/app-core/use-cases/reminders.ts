import { diffDays } from "../../lib/dates";
import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { computeDueReminders, type ReminderKey } from "../../modules/reminders/due";
import { reminderEmail } from "../../modules/reminders/email";
import { err, type HrAppContext } from "../context";

export type ReminderRunResult = { sent: string[]; failed: { certificateId: string; code: string }[]; skipped: { certificateId: string; code: string }[] };
export type ReminderTestResult = { to: string[]; subject: string };
const TEST_PREFIX = "[Gửi thử] ";
const TEST_NOTE = "Đây là email GỬI THỬ từ hệ thống quản lý nhân sự Thiên Nhật Minh, dùng mẫu nhắc hạn thật với chứng chỉ sắp hết hạn gần nhất. Không có gì bị đánh dấu là đã gửi.";

export function createReminderUseCases(ctx: HrAppContext) {
  const { deps, repositories, today, has, writeAudit, sentReminders } = ctx;

  const reminderUseCases = {
    computeDue: async (actor: Actor): Promise<Result<ReturnType<typeof computeDueReminders>>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), settings.sendExpiredNotice, (await sentReminders()).keys);
      return success(candidates);
    },
    run: async (actor: Actor): Promise<Result<ReminderRunResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), settings.sendExpiredNotice, (await sentReminders()).keys);
      const result: ReminderRunResult = { sent: [], failed: [], skipped: [] };
      for (const candidate of candidates) {
        if (!settings.reminderEmails.length) { result.skipped.push({ certificateId: candidate.certificate.id, code: "NO_RECIPIENT" }); continue; }
        if (!deps.mailer) { result.failed.push({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" }); continue; }
        const category = (await repositories.certificateTypes.list()).find((item) => item.key === candidate.certificate.type);
        const message = reminderEmail(candidate.employee, candidate.certificate, candidate.daysLeft, `${deps.profileBaseUrl ?? "/employees/"}${candidate.employee.id}`, category);
        try {
          await deps.mailer.send({ to: settings.reminderEmails, ...message });
          const key: ReminderKey = candidate.key;
          const reminderIdentity = `${key.certificateId}|${key.kind}|${key.expiryDate}`;
          await repositories.reminders.add({ identity: reminderIdentity, certificateId: key.certificateId, sentOn: today() });
          await writeAudit(actor, "reminder.sent", "certificate", key.certificateId, null, key);
          result.sent.push(key.certificateId);
        } catch { result.failed.push({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" }); }
      }
      return success(result);
    },
    /** Gửi một email mẫu (chứng chỉ hết hạn gần nhất) tới địa chỉ nhận nhắc hạn; không ghi nhật ký gửi nên không ảnh hưởng lịch nhắc thật. */
    sendTest: async (actor: Actor): Promise<Result<ReminderTestResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      if (!settings.reminderEmails.length) return err("NO_RECIPIENT");
      if (!deps.mailer) return err("REMINDER_NOT_CONFIGURED");
      const employees = new Map((await repositories.employees.list()).filter((item) => !item.archivedAt).map((item) => [item.id, item]));
      const soonest = (await repositories.certificates.list())
        .filter((item) => item.state === "current" && item.expiryDate !== null && employees.has(item.employeeId))
        .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))[0];
      let message: { subject: string; text: string; html?: string } = { subject: "Kiểm tra email nhắc hạn chứng chỉ", text: `${TEST_NOTE}

Hiện chưa có chứng chỉ nào có ngày hết hạn để làm mẫu.` };
      if (soonest?.expiryDate) {
        const employee = employees.get(soonest.employeeId)!;
        const category = (await repositories.certificateTypes.list()).find((item) => item.key === soonest.type);
        message = reminderEmail(employee, soonest, diffDays(today(), soonest.expiryDate), `${deps.profileBaseUrl ?? "/employees/"}${employee.id}`, category, { note: TEST_NOTE });
      }
      const subject = TEST_PREFIX + message.subject;
      try { await deps.mailer.send({ to: settings.reminderEmails, ...message, subject }); }
      catch { return err("MAIL_TEST_FAILED"); }
      await writeAudit(actor, "reminder.test", "settings", "global", null, { to: settings.reminderEmails, subject });
      return success({ to: settings.reminderEmails, subject });
    },
  };

  return reminderUseCases;
}
