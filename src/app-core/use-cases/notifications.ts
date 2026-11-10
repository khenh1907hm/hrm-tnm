import { failure, issue, success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { certificateDigestTelegram, collectCertificateDigest, digestIdentity, digestSummary, DIGEST_WINDOW_DAYS, type CertificateDigest } from "../../modules/notifications/certificateDigest";
import { NOTIFICATION_TOPICS, type NotificationTarget, type NotificationTopic } from "../../modules/notifications/types";
import { reminderDigestEmail } from "../../modules/reminders/email";
import { err, type HrAppContext } from "../context";

export type NotificationTargetInput = { name: string; chatId: string; enabled: boolean; topics?: NotificationTopic[] };
export type DigestDelivery = { channel: "email" | "telegram"; targetId: string | null; name: string; status: "sent" | "already_sent" | "skipped" | "failed"; code?: string };
export type DigestRunResult = { date: string; total: number; expired: number; expiring: number; deliveries: DigestDelivery[] };
export type TelegramTestResult = { name: string; count: number };

const MAX_TARGETS = 20;
const TEST_NOTE = "GỬI THỬ từ hệ thống quản lý nhân sự Thiên Nhật Minh. Không ảnh hưởng bản tin hằng ngày.";
const DIGEST_FOOTER = `Bản tin tự động mỗi sáng từ hệ thống quản lý nhân sự Thiên Nhật Minh: mọi chứng chỉ đã hết hạn hoặc còn tối đa ${DIGEST_WINDOW_DAYS} ngày. Tắt bản tin email trong Cài đặt email nhắc hạn.`;

/** Chat ID Telegram: số nguyên (người dùng dương, nhóm âm, vd -1001234567890) hoặc @tên_kênh công khai. */
export const isTelegramChatId = (value: string) => /^-?\d{3,20}$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);

export function createNotificationUseCases(ctx: HrAppContext) {
  const { deps, repositories, today, has, writeAudit } = ctx;
  const profileUrl = (employeeId: string) => `${deps.profileBaseUrl ?? "/employees/"}${employeeId}`;

  const validate = (input: NotificationTargetInput): { value: Omit<NotificationTarget, "id" | "version" | "channel"> } | { code: string; field: string } => {
    const name = input.name.trim();
    const chatId = input.chatId.trim();
    if (!name || name.length > 80) return { code: "NOTIFY_NAME_INVALID", field: "name" };
    if (!isTelegramChatId(chatId)) return { code: "NOTIFY_CHAT_ID_INVALID", field: "chatId" };
    const topics = [...new Set(input.topics ?? ["certificate_digest"])].filter((topic): topic is NotificationTopic => NOTIFICATION_TOPICS.some((item) => item.key === topic));
    return { value: { name, chatId, enabled: input.enabled, topics } };
  };

  const loadDigest = async (): Promise<CertificateDigest> => collectCertificateDigest({
    certificates: await repositories.certificates.list(), employees: await repositories.employees.list(),
    certificateTypes: await repositories.certificateTypes.list(), today: today(), profileUrl,
  });

  const digestEmail = (digest: CertificateDigest, note?: string) => {
    const subject = `Bản tin chứng chỉ ${digest.items.length ? `${digest.items.length} cần gia hạn` : "không có chứng chỉ cần gia hạn"}${digest.items.length ? ` (${[digest.expired ? `${digest.expired} đã hết hạn` : "", digest.expiring ? `${digest.expiring} sắp hết hạn` : ""].filter(Boolean).join(", ")})` : ""} · ${digest.today.split("-").reverse().join("/")}`;
    if (!digest.items.length) return { subject, text: `${note ? `${note}\n\n` : ""}Hôm nay ${digestSummary(digest)}.` };
    const message = reminderDigestEmail(digest.items, { today: digest.today, heading: "Bản tin chứng chỉ", footer: DIGEST_FOOTER, ...(note ? { note } : {}) });
    return { ...message, subject };
  };

  const notifications = {
    listTargets: async (actor: Actor): Promise<Result<NotificationTarget[]>> => {
      if (!has(actor, "notificationManage")) return err("FORBIDDEN");
      return success((await repositories.notificationTargets.list()).sort((a, b) => a.name.localeCompare(b.name, "vi")));
    },
    /** Thêm (không có id) hoặc sửa (có id + expectedVersion) một nơi nhận Telegram. */
    saveTarget: async (actor: Actor, input: NotificationTargetInput & { id?: string; expectedVersion?: number }): Promise<Result<NotificationTarget>> => {
      if (!has(actor, "notificationManage")) return err("FORBIDDEN");
      const checked = validate(input);
      if ("code" in checked) return err(checked.code, checked.field);
      const all = await repositories.notificationTargets.list();
      if (all.some((item) => item.id !== input.id && item.chatId === checked.value.chatId)) return err("NOTIFY_CHAT_ID_DUPLICATE", "chatId");
      if (!input.id) {
        if (all.length >= MAX_TARGETS) return err("NOTIFY_TARGET_LIMIT");
        const created: NotificationTarget = { id: deps.ids.next(), channel: "telegram", ...checked.value, version: 1 };
        await repositories.notificationTargets.insert(created);
        await writeAudit(actor, "notificationTarget.create", "notificationTarget", created.id, null, created);
        return success(created);
      }
      const before = await repositories.notificationTargets.get(input.id);
      if (!before) return err("NOTIFY_TARGET_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const after: NotificationTarget = { ...before, ...checked.value, version: before.version + 1 };
      if (!await repositories.notificationTargets.replace(after, before.version)) return err("CONFLICT");
      await writeAudit(actor, "notificationTarget.update", "notificationTarget", after.id, before, after);
      return success(after);
    },
    removeTarget: async (actor: Actor, id: string): Promise<Result<{ id: string }>> => {
      if (!has(actor, "notificationManage")) return err("FORBIDDEN");
      const before = await repositories.notificationTargets.get(id);
      if (!before || !await repositories.notificationTargets.remove(id)) return err("NOTIFY_TARGET_NOT_FOUND");
      await writeAudit(actor, "notificationTarget.remove", "notificationTarget", id, before, null);
      return success({ id });
    },

    /**
     * Bản tin chứng chỉ hằng ngày: một email tới các địa chỉ nhận nhắc hạn (nếu bật) và một tin tới mỗi nơi nhận Telegram đang bật.
     * Mỗi nơi nhận chỉ nhận một lần mỗi ngày (giữ chỗ trong notification_log trước khi gửi); gửi lỗi thì bỏ giữ chỗ để lần chạy sau trong ngày thử lại.
     */
    runDailyDigest: async (actor: Actor): Promise<Result<DigestRunResult>> => {
      if (!has(actor, "reminderRun")) return err("FORBIDDEN");
      const date = today();
      const digest = await loadDigest();
      const settings = await repositories.settings.get();
      const deliveries: DigestDelivery[] = [];
      const deliver = async (delivery: Omit<DigestDelivery, "status" | "code">, send: () => Promise<void>) => {
        const recipient = delivery.channel === "email" ? "email" : `telegram:${delivery.targetId}`;
        const identity = digestIdentity(date, recipient);
        // Giữ chỗ trước rồi mới gửi: hai lần chạy cùng lúc chỉ một lần gửi được
        if (!await repositories.notificationLog.claim({ identity, topic: "certificate_digest", channel: delivery.channel, targetId: delivery.targetId, sentOn: date })) { deliveries.push({ ...delivery, status: "already_sent" }); return; }
        try { await send(); }
        catch {
          await repositories.notificationLog.release(identity);
          deliveries.push({ ...delivery, status: "failed", code: delivery.channel === "email" ? "MAIL_SEND_FAILED" : "TELEGRAM_SEND_FAILED" }); return;
        }
        await writeAudit(actor, "notification.digest", "notification", identity, null, { channel: delivery.channel, name: delivery.name, total: digest.items.length });
        deliveries.push({ ...delivery, status: "sent" });
      };

      const email = { channel: "email" as const, targetId: null, name: settings.reminderEmails.join(", ") || "Email" };
      if (!settings.dailyDigestEmail) deliveries.push({ ...email, status: "skipped", code: "DIGEST_EMAIL_DISABLED" });
      else if (!settings.reminderEmails.length) deliveries.push({ ...email, status: "skipped", code: "NO_RECIPIENT" });
      else if (!deps.mailer) deliveries.push({ ...email, status: "skipped", code: "REMINDER_NOT_CONFIGURED" });
      else { const mailer = deps.mailer; await deliver(email, () => mailer.send({ to: settings.reminderEmails, ...digestEmail(digest) })); }

      const text = certificateDigestTelegram(digest, deps.appBaseUrl ? { appUrl: deps.appBaseUrl } : {});
      for (const target of await repositories.notificationTargets.list()) {
        if (!target.enabled || !target.topics.includes("certificate_digest")) continue;
        const delivery = { channel: "telegram" as const, targetId: target.id, name: target.name };
        if (!deps.telegram) { deliveries.push({ ...delivery, status: "skipped", code: "TELEGRAM_NOT_CONFIGURED" }); continue; }
        const telegram = deps.telegram;
        await deliver(delivery, () => telegram.send(target.chatId, text));
      }
      return success({ date, total: digest.items.length, expired: digest.expired, expiring: digest.expiring, deliveries });
    },

    /** Gửi bản tin hôm nay (có ghi chú GỬI THỬ) tới một nơi nhận Telegram; không ghi nhật ký gửi nên bản tin thật vẫn đi. */
    sendTelegramTest: async (actor: Actor, targetId: string): Promise<Result<TelegramTestResult>> => {
      if (!has(actor, "notificationManage")) return err("FORBIDDEN");
      const target = await repositories.notificationTargets.get(targetId);
      if (!target) return err("NOTIFY_TARGET_NOT_FOUND");
      if (!deps.telegram) return err("TELEGRAM_NOT_CONFIGURED");
      const digest = await loadDigest();
      try { await deps.telegram.send(target.chatId, certificateDigestTelegram(digest, { note: TEST_NOTE, ...(deps.appBaseUrl ? { appUrl: deps.appBaseUrl } : {}) })); }
      catch (error) { return failure([issue("TELEGRAM_TEST_FAILED", undefined, "error", { detail: error instanceof Error ? error.message.slice(0, 200) : "" })]); }
      await writeAudit(actor, "notification.test", "notificationTarget", target.id, null, { name: target.name });
      return success({ name: target.name, count: digest.items.length });
    },
  };

  return notifications;
}
