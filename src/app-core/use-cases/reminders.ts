import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { computeDueReminders, type ReminderKey } from "../../modules/reminders/due";
import { reminderEmail } from "../../modules/reminders/email";
import { err, type HrAppContext } from "../context";

export type ReminderRunResult = { sent: string[]; failed: { certificateId: string; code: string }[]; skipped: { certificateId: string; code: string }[] };

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
  };

  return reminderUseCases;
}
