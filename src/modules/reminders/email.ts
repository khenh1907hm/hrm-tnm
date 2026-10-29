import { formatDate } from "../../lib/dates";
import type { Certificate } from "../certificates/types";
import { certificateDisplayName } from "../certificates/rules";
import type { CertificateTypeRecord } from "../certificate-types/types";
import type { Employee } from "../employees/types";

export type ReminderEmail = { subject: string; text: string; html: string };
export type ReminderEmailItem = { employee: Employee; certificate: Certificate; daysLeft: number; profileUrl: string; certificateType?: CertificateTypeRecord | undefined };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Tình trạng theo số ngày còn lại: chữ và màu (nền, chữ) dùng trong email. */
function expiryState(daysLeft: number): { label: string; bg: string; fg: string } {
  if (daysLeft < 0) return { label: `Quá hạn ${-daysLeft} ngày`, bg: "#fee2e2", fg: "#991b1b" };
  if (daysLeft === 0) return { label: "Hết hạn hôm nay", bg: "#fee2e2", fg: "#991b1b" };
  if (daysLeft <= 30) return { label: `Còn ${daysLeft} ngày`, bg: "#ffedd5", fg: "#9a3412" };
  return { label: `Còn ${daysLeft} ngày`, bg: "#fef9c3", fg: "#854d0e" };
}

/**
 * MỘT email tổng hợp mọi chứng chỉ cần nhắc: bảng ngang, mỗi chứng chỉ một dòng (hạn gần nhất lên trước), mỗi dòng có nút mở hồ sơ.
 * Kèm bản chữ thường cho trình đọc thư không hiện HTML. `note` (vd ghi chú gửi thử) hiện ở đầu thư.
 */
export function reminderDigestEmail(items: readonly ReminderEmailItem[], options: { today: string; note?: string }): ReminderEmail {
  const rows = [...items].sort((a, b) => a.daysLeft - b.daysLeft || a.employee.code.localeCompare(b.employee.code, "en", { numeric: true })).map((item) => ({
    ...item,
    name: certificateDisplayName(item.certificateType ?? item.certificate.type, item.certificate.title),
    state: expiryState(item.daysLeft),
    // Chỉ gắn nút khi có địa chỉ đầy đủ (APP_BASE_URL); đường dẫn tương đối không bấm được trong hộp thư
    linkable: /^https?:\/\//i.test(item.profileUrl),
  }));
  const expired = rows.filter((row) => row.daysLeft < 0).length;
  const soon = rows.length - expired;
  const summary = [expired ? `${expired} đã hết hạn` : "", soon ? `${soon} sắp hết hạn` : ""].filter(Boolean).join(", ");
  const subject = `Nhắc hạn chứng chỉ: ${rows.length} chứng chỉ cần gia hạn${summary ? ` (${summary})` : ""} · ${formatDate(options.today)}`;

  const text = [
    ...(options.note ? [options.note, ""] : []),
    `${rows.length} chứng chỉ cần gia hạn${summary ? ` (${summary})` : ""}, tính đến ${formatDate(options.today)}:`,
    "",
    ...rows.map((row, index) => `${index + 1}. ${row.employee.name} (${row.employee.code}) · ${row.name} · Số ${row.certificate.number || "không ghi"} · Hết hạn ${row.certificate.expiryDate ? formatDate(row.certificate.expiryDate) : "không thời hạn"} · ${row.state.label}\n   Mở hồ sơ: ${row.profileUrl}`),
  ].join("\n");

  const th = "padding:10px 10px;background:#1e3a8a;color:#ffffff;font-size:12px;font-weight:700;text-align:left;white-space:nowrap;";
  const td = "padding:10px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;line-height:18px;color:#0f172a;vertical-align:middle;";
  const tableRows = rows.map((row, index) => `<tr style="background:${index % 2 ? "#f8fafc" : "#ffffff"};">
<td style="${td}color:#64748b;text-align:center;">${index + 1}</td>
<td style="${td}"><b>${escapeHtml(row.employee.name)}</b><br><span style="color:#64748b;font-size:12px;">${escapeHtml(row.employee.code)} · ${escapeHtml(row.employee.position || "")}</span></td>
<td style="${td}">${escapeHtml(row.name)}</td>
<td style="${td}white-space:nowrap;">${escapeHtml(row.certificate.number || "—")}</td>
<td style="${td}white-space:nowrap;font-weight:700;color:${row.state.fg};">${row.certificate.expiryDate ? formatDate(row.certificate.expiryDate) : "—"}</td>
<td style="${td}white-space:nowrap;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${row.state.bg};color:${row.state.fg};font-weight:700;font-size:12px;">${escapeHtml(row.state.label)}</span></td>
<td style="${td}text-align:center;">${row.linkable ? `<a href="${escapeHtml(row.profileUrl)}" style="display:inline-block;padding:7px 14px;background:#2563eb;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border-radius:6px;white-space:nowrap;">Mở hồ sơ</a>` : "—"}</td>
</tr>`).join("");
  const chip = (count: number, label: string, bg: string, fg: string) => count ? `<td style="padding-right:8px;"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:700;">${count} ${label}</span></td>` : "";

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:900px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#0f2350;padding:18px 24px;color:#ffffff;">
  <div style="font-size:12px;letter-spacing:1px;color:#c7d4f0;">THIÊN NHẬT MINH · QUẢN LÝ NHÂN SỰ</div>
  <div style="font-size:20px;font-weight:700;margin-top:4px;">Nhắc hạn chứng chỉ · ${formatDate(options.today)}</div>
</td></tr>
${options.note ? `<tr><td style="padding:12px 24px;background:#eff6ff;color:#1e40af;font-size:13px;line-height:19px;border-bottom:1px solid #dbeafe;">${escapeHtml(options.note)}</td></tr>` : ""}
<tr><td style="padding:20px 24px 12px;">
  <p style="margin:0 0 12px;font-size:15px;color:#0f172a;">Có <b>${rows.length} chứng chỉ</b> cần gia hạn. Vui lòng gia hạn và cập nhật bản mới vào hồ sơ.</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>${chip(expired, "đã hết hạn", "#fee2e2", "#991b1b")}${chip(soon, "sắp hết hạn", "#ffedd5", "#9a3412")}</tr></table>
</td></tr>
<tr><td style="padding:0 24px 8px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-collapse:collapse;">
    <tr><th style="${th}text-align:center;">STT</th><th style="${th}">Nhân sự</th><th style="${th}">Chứng chỉ</th><th style="${th}">Số chứng chỉ</th><th style="${th}">Ngày hết hạn</th><th style="${th}">Tình trạng</th><th style="${th}text-align:center;">Hồ sơ</th></tr>
    ${tableRows}
  </table>
</td></tr>
<tr><td style="padding:16px 24px 20px;font-size:12px;line-height:18px;color:#94a3b8;">
  Email tự động từ hệ thống quản lý nhân sự Thiên Nhật Minh. Mỗi chứng chỉ được nhắc khi còn 30 ngày (và khi đã hết hạn nếu bật trong Cài đặt email).
</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
