import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { computeDueReminders, type ReminderKey } from "../../modules/reminders/due";
import { reminderEmail } from "../../modules/reminders/email";
import { err, type HrAppContext } from "../context";

export type ReminderRunResult = { sent: string[]; failed: { certificateId: string; code: string }[]; skipped: { certificateId: string; code: string }[] };

export function createReminderUseCases(ctx: HrAppContext) {
  const { deps, repositories, state, today, has, writeAudit } = ctx;
  const { sentReminderKeys, sentReminderDates } = state;

  const reminderUseCases = {
    computeDue: async (actor: Actor): Promise<Result<ReturnType<typeof computeDueReminders>>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), state.settings.sendExpiredNotice, sentReminderKeys);
      return success(candidates);
    },
    run: async (actor: Actor): Promise<Result<ReminderRunResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), state.settings.sendExpiredNotice, sentReminderKeys);
      const result: ReminderRunResult = { sent: [], failed: [], skipped: [] };
      for (const candidate of candidates) {
        if (!state.settings.reminderEmails.length) { result.skipped.push({ certificateId: candidate.certificate.id, code: "NO_RECIPIENT" }); continue; }
        if (!deps.mailer) { result.failed.push({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" }); continue; }
        const category = (await repositories.certificateTypes.list()).find((item) => item.key === candidate.certificate.type);
        const message = reminderEmail(candidate.employee, candidate.certificate, candidate.daysLeft, `${deps.profileBaseUrl ?? "/employees/"}${candidate.employee.id}`, category);
        try {
          await deps.mailer.send({ to: state.settings.reminderEmails, ...message });
          const key: ReminderKey = candidate.key;
          const reminderIdentity = `${key.certificateId}|${key.kind}|${key.expiryDate}`;
          sentReminderKeys.push(reminderIdentity);
          sentReminderDates.set(reminderIdentity, today());
          await writeAudit(actor, "reminder.sent", "certificate", key.certificateId, null, key);
          result.sent.push(key.certificateId);
        } catch { result.failed.push({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" }); }
      }
      return success(result);
    },
  };

  return reminderUseCases;
}
