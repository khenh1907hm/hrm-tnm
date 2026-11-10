import { diffDays, formatDate } from "../../lib/dates";
import type { CertificateTypeRecord } from "../certificate-types/types";
import { certificateDisplayName } from "../certificates/rules";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";
import type { ReminderEmailItem } from "../reminders/email";

/** Bản tin đếm chứng chỉ còn tối đa bấy nhiêu ngày (cùng mốc nhắc hạn email), cộng mọi chứng chỉ đã hết hạn. */
export const DIGEST_WINDOW_DAYS = 30;
/** Số dòng tối đa trong tin Telegram; phần còn lại gộp thành "… và N chứng chỉ khác". */
export const DIGEST_TELEGRAM_MAX_LINES = 30;
/** Telegram giới hạn 4.096 ký tự mỗi tin; chừa chỗ cho dòng cuối. */
const TELEGRAM_LIMIT = 3800;

export type CertificateDigest = { today: string; items: ReminderEmailItem[]; expired: number; expiring: number };

/**
 * Chứng chỉ hiện hành có ngày hết hạn, của nhân sự đang làm (active, on_leave, không ẩn), đã hết hạn hoặc còn ≤ 30 ngày.
 * Hạn gần nhất lên trước. Khác nhắc hạn email: bản tin đếm lại tất cả mỗi ngày, không phụ thuộc đã nhắc hay chưa.
 */
export function collectCertificateDigest(input: {
  certificates: readonly Certificate[]; employees: readonly Employee[]; certificateTypes: readonly CertificateTypeRecord[];
  today: string; profileUrl: (employeeId: string) => string;
}): CertificateDigest {
  const people = new Map(input.employees.filter((item) => item.archivedAt === null && ["active", "on_leave"].includes(item.status)).map((item) => [item.id, item]));
  const items: ReminderEmailItem[] = [];
  for (const certificate of input.certificates) {
    if (certificate.state !== "current" || certificate.expiryDate === null) continue;
    const employee = people.get(certificate.employeeId);
    if (!employee) continue;
    const daysLeft = diffDays(input.today, certificate.expiryDate);
    if (daysLeft > DIGEST_WINDOW_DAYS) continue;
    items.push({ employee, certificate, daysLeft, profileUrl: input.profileUrl(employee.id), certificateType: input.certificateTypes.find((type) => type.key === certificate.type) });
  }
  items.sort((a, b) => a.daysLeft - b.daysLeft || a.employee.code.localeCompare(b.employee.code, "en", { numeric: true }));
  const expired = items.filter((item) => item.daysLeft < 0).length;
  return { today: input.today, items, expired, expiring: items.length - expired };
}

/** Khóa chống gửi trùng: một bản tin mỗi ngày cho mỗi nơi nhận (`email` hoặc `telegram:<id nơi nhận>`). */
export const digestIdentity = (today: string, recipient: string) => `certificate_digest|${today}|${recipient}`;

const escapeTelegram = (value: string) => value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft < 0) return `quá hạn ${-daysLeft} ngày`;
  if (daysLeft === 0) return "hết hạn hôm nay";
  return `còn ${daysLeft} ngày`;
}

/** Dòng tóm tắt dùng chung cho tiêu đề email và tin Telegram. */
export function digestSummary(digest: Pick<CertificateDigest, "items" | "expired" | "expiring">): string {
  if (!digest.items.length) return `không có chứng chỉ nào hết hạn hoặc còn dưới ${DIGEST_WINDOW_DAYS} ngày`;
  const parts = [digest.expired ? `${digest.expired} đã hết hạn` : "", digest.expiring ? `${digest.expiring} sắp hết hạn` : ""].filter(Boolean).join(", ");
  return `${digest.items.length} chứng chỉ cần gia hạn (${parts})`;
}

/**
 * Tin Telegram (parse_mode HTML): tiêu đề, tổng số, số đã hết hạn / sắp hết hạn, rồi danh sách ngắn
 * "tên người — loại chứng chỉ — ngày hết hạn (còn / quá hạn N ngày)", hạn gần nhất lên trước.
 * Dài quá thì cắt và ghi "… và N chứng chỉ khác". Mọi giá trị được thoát HTML.
 */
export function certificateDigestTelegram(digest: CertificateDigest, options: { appUrl?: string; note?: string; maxLines?: number } = {}): string {
  const maxLines = options.maxLines ?? DIGEST_TELEGRAM_MAX_LINES;
  const head = [
    ...(options.note ? [`<i>${escapeTelegram(options.note)}</i>`, ""] : []),
    `📋 <b>Bản tin chứng chỉ · ${formatDate(digest.today)}</b>`,
  ];
  if (!digest.items.length) {
    head.push(`✅ Không có chứng chỉ nào đã hết hạn hoặc còn dưới ${DIGEST_WINDOW_DAYS} ngày.`);
    return head.join("\n");
  }
  head.push(`Tổng: <b>${digest.items.length}</b> chứng chỉ cần gia hạn`);
  if (digest.expired) head.push(`🔴 Đã hết hạn: <b>${digest.expired}</b>`);
  if (digest.expiring) head.push(`🟠 Sắp hết hạn (≤ ${DIGEST_WINDOW_DAYS} ngày): <b>${digest.expiring}</b>`);
  head.push("");

  const footer = /^https?:\/\//i.test(options.appUrl ?? "") ? [`\nXem chi tiết: ${escapeTelegram(`${options.appUrl!.replace(/\/$/, "")}/canh-bao`)}`] : [];
  const lines: string[] = [];
  let length = head.join("\n").length + footer.join("\n").length;
  let shown = 0;
  for (const [index, item] of digest.items.entries()) {
    const name = certificateDisplayName(item.certificateType ?? item.certificate.type, item.certificate.title);
    const line = `${index + 1}. ${item.daysLeft < 0 ? "🔴" : "🟠"} ${escapeTelegram(item.employee.name)} — ${escapeTelegram(name)} — ${formatDate(item.certificate.expiryDate!)} (${daysLeftLabel(item.daysLeft)})`;
    if (shown >= maxLines || length + line.length + 1 > TELEGRAM_LIMIT) break;
    lines.push(line); length += line.length + 1; shown += 1;
  }
  const rest = digest.items.length - shown;
  if (rest > 0) lines.push(`… và ${rest} chứng chỉ khác.`);
  return [...head, ...lines, ...footer].join("\n");
}
