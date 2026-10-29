import { diffDays } from "../../lib/dates";
import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { computeDueReminders } from "../../modules/reminders/due";
import { reminderDigestEmail, type ReminderEmailItem } from "../../modules/reminders/email";
import { err, type HrAppContext } from "../context";

export type ReminderRunResult = { sent: string[]; failed: { certificateId: string; code: string }[]; skipped: { certificateId: string; code: string }[] };
export type ReminderTestResult = { to: string[]; subject: string; count: number };
const TEST_PREFIX = "[Gửi thử] ";
const TEST_NOTE = "Đây là email GỬI THỬ từ hệ thống quản lý nhân sự Thiên Nhật Minh: liệt kê các chứng chỉ đã hết hạn hoặc còn tối đa 60 ngày (như trang Cảnh báo). Không có gì bị đánh dấu là đã gửi.";
/** Gửi thử lấy các chứng chỉ giống trang Cảnh báo: đã hết hạn hoặc còn tối đa 60 ngày. */
const TEST_WINDOW_DAYS = 60;

export function createReminderUseCases(ctx: HrAppContext) {
  const { deps, repositories, today, has, writeAudit, sentReminders } = ctx;
  const profileUrl = (employeeId: string) => `${deps.profileBaseUrl ?? "/employees/"}${employeeId}`;

  const reminderUseCases = {
    computeDue: async (actor: Actor): Promise<Result<ReturnType<typeof computeDueReminders>>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), settings.sendExpiredNotice, (await sentReminders()).keys);
      return success(candidates);
    },
    /** Gửi MỘT email tổng hợp mọi chứng chỉ đến hạn nhắc; gửi được thì ghi nhận từng chứng chỉ là đã nhắc, lỗi thì không ghi để lần sau thử lại. */
    run: async (actor: Actor): Promise<Result<ReminderRunResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      const candidates = computeDueReminders(await repositories.certificates.list(), await repositories.employees.list(), today(), settings.sendExpiredNotice, (await sentReminders()).keys);
      const result: ReminderRunResult = { sent: [], failed: [], skipped: [] };
      if (!candidates.length) return success(result);
      if (!settings.reminderEmails.length) { result.skipped.push(...candidates.map((candidate) => ({ certificateId: candidate.certificate.id, code: "NO_RECIPIENT" }))); return success(result); }
      if (!deps.mailer) { result.failed.push(...candidates.map((candidate) => ({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" }))); return success(result); }
      const types = await repositories.certificateTypes.list();
      const message = reminderDigestEmail(candidates.map((candidate) => ({
        employee: candidate.employee, certificate: candidate.certificate, daysLeft: candidate.daysLeft, profileUrl: profileUrl(candidate.employee.id),
        certificateType: types.find((item) => item.key === candidate.certificate.type),
      })), { today: today() });
      try {
        await deps.mailer.send({ to: settings.reminderEmails, ...message });
      } catch {
        result.failed.push(...candidates.map((candidate) => ({ certificateId: candidate.certificate.id, code: "MAIL_SEND_FAILED" })));
        return success(result);
      }
      for (const { key } of candidates) {
        await repositories.reminders.add({ identity: `${key.certificateId}|${key.kind}|${key.expiryDate}`, certificateId: key.certificateId, sentOn: today() });
        await writeAudit(actor, "reminder.sent", "certificate", key.certificateId, null, key);
        result.sent.push(key.certificateId);
      }
      return success(result);
    },
    /** Gửi một email tổng hợp mẫu tới địa chỉ nhận nhắc hạn; không ghi nhật ký gửi nên không ảnh hưởng lịch nhắc thật. */
    sendTest: async (actor: Actor): Promise<Result<ReminderTestResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const settings = await repositories.settings.get();
      if (!settings.reminderEmails.length) return err("NO_RECIPIENT");
      if (!deps.mailer) return err("REMINDER_NOT_CONFIGURED");
      const employees = new Map((await repositories.employees.list()).filter((item) => !item.archivedAt && item.status !== "resigned").map((item) => [item.id, item]));
      const types = await repositories.certificateTypes.list();
      const withExpiry = (await repositories.certificates.list())
        .filter((item) => item.state === "current" && item.expiryDate !== null && employees.has(item.employeeId))
        .map((certificate): ReminderEmailItem => ({
          employee: employees.get(certificate.employeeId)!, certificate, daysLeft: diffDays(today(), certificate.expiryDate!), profileUrl: profileUrl(certificate.employeeId),
          certificateType: types.find((item) => item.key === certificate.type),
        }))
        .sort((a, b) => a.daysLeft - b.daysLeft);
      // Không có chứng chỉ nào trong 60 ngày thì lấy chứng chỉ hết hạn gần nhất làm mẫu
      const items = withExpiry.filter((item) => item.daysLeft <= TEST_WINDOW_DAYS);
      const chosen = items.length ? items : withExpiry.slice(0, 1);
      const message = chosen.length
        ? reminderDigestEmail(chosen, { today: today(), note: TEST_NOTE })
        : { subject: "Kiểm tra email nhắc hạn chứng chỉ", text: `${TEST_NOTE}\n\nHiện chưa có chứng chỉ nào có ngày hết hạn để làm mẫu.` };
      const subject = TEST_PREFIX + message.subject;
      try { await deps.mailer.send({ to: settings.reminderEmails, ...message, subject }); }
      catch { return err("MAIL_TEST_FAILED"); }
      await writeAudit(actor, "reminder.test", "settings", "global", null, { to: settings.reminderEmails, subject });
      return success({ to: settings.reminderEmails, subject, count: chosen.length });
    },
  };

  return reminderUseCases;
}
