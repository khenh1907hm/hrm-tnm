import { formatDate } from "../../lib/dates";
import type { Certificate } from "../certificates/types";
import { certificateDisplayName } from "../certificates/rules";
import type { CertificateTypeRecord } from "../certificate-types/types";
import type { Employee } from "../employees/types";

export type ReminderEmail = { subject: string; text: string; html: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Tình trạng theo số ngày còn lại: chữ và màu (nền, chữ) dùng trong email. */
function expiryState(daysLeft: number): { label: string; short: string; bg: string; fg: string } {
  if (daysLeft < 0) return { label: `Đã hết hạn ${-daysLeft} ngày`, short: `quá hạn ${-daysLeft} ngày`, bg: "#fee2e2", fg: "#991b1b" };
  if (daysLeft === 0) return { label: "Hết hạn hôm nay", short: "hết hạn hôm nay", bg: "#fee2e2", fg: "#991b1b" };
  if (daysLeft <= 30) return { label: `Còn ${daysLeft} ngày nữa hết hạn`, short: `còn ${daysLeft} ngày`, bg: "#ffedd5", fg: "#9a3412" };
  return { label: `Còn ${daysLeft} ngày nữa hết hạn`, short: `còn ${daysLeft} ngày`, bg: "#fef9c3", fg: "#854d0e" };
}

/**
 * Email nhắc hạn một chứng chỉ: bảng thông tin chi tiết + nút mở hồ sơ (HTML), kèm bản chữ thường cho trình đọc thư không hiện HTML.
 * `note` (vd ghi chú gửi thử) hiện ở đầu thư.
 */
export function reminderEmail(employee: Employee, certificate: Certificate, daysLeft: number, profileUrl: string, certificateType?: CertificateTypeRecord, options: { note?: string } = {}): ReminderEmail {
  const displayName = certificateDisplayName(certificateType ?? certificate.type, certificate.title);
  const state = expiryState(daysLeft);
  const rows: [string, string][] = [
    ["Nhân sự", employee.name],
    ["Mã nhân viên", employee.code],
    ["Chức danh", employee.position || "—"],
    ["Điện thoại", employee.phone || "—"],
    ["Chứng chỉ", displayName],
    ["Số chứng chỉ", certificate.number || "Không ghi số"],
    ["Ngày cấp", certificate.issueDate ? formatDate(certificate.issueDate) : "—"],
    ["Ngày hết hạn", certificate.expiryDate ? formatDate(certificate.expiryDate) : "Không thời hạn"],
    ["Số ngày còn lại", String(daysLeft)],
  ];
  // Chỉ gắn nút khi có địa chỉ đầy đủ (APP_BASE_URL); đường dẫn tương đối không bấm được trong hộp thư
  const linkable = /^https?:\/\//i.test(profileUrl);

  const text = [
    ...(options.note ? [options.note, ""] : []),
    `${state.label.toUpperCase()}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Mở hồ sơ: ${profileUrl}`,
  ].join("\n");

  const cell = "padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:20px;";
  const tableRows = rows.map(([label, value], index) => {
    const highlight = label === "Ngày hết hạn" || label === "Số ngày còn lại";
    const valueStyle = highlight ? `color:${state.fg};font-weight:700;` : "color:#0f172a;";
    return `<tr style="background:${index % 2 ? "#f8fafc" : "#ffffff"}"><td style="${cell}color:#475569;width:38%;">${escapeHtml(label)}</td><td style="${cell}${valueStyle}">${escapeHtml(value)}</td></tr>`;
  }).join("");
  const button = linkable
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;"><tr><td style="border-radius:8px;background:#2563eb;"><a href="${escapeHtml(profileUrl)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">Mở hồ sơ nhân sự</a></td></tr></table>
       <p style="margin:0;text-align:center;font-size:12px;color:#94a3b8;">Nút không bấm được? Sao chép đường dẫn: <a href="${escapeHtml(profileUrl)}" style="color:#2563eb;">${escapeHtml(profileUrl)}</a></p>`
    : "";

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(displayName)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#0f2350;padding:18px 24px;color:#ffffff;">
  <div style="font-size:12px;letter-spacing:1px;color:#c7d4f0;">THIÊN NHẬT MINH · QUẢN LÝ NHÂN SỰ</div>
  <div style="font-size:20px;font-weight:700;margin-top:4px;">Nhắc hạn chứng chỉ</div>
</td></tr>
${options.note ? `<tr><td style="padding:12px 24px;background:#eff6ff;color:#1e40af;font-size:13px;line-height:19px;border-bottom:1px solid #dbeafe;">${escapeHtml(options.note)}</td></tr>` : ""}
<tr><td style="padding:22px 24px 4px;">
  <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${state.bg};color:${state.fg};font-size:14px;font-weight:700;">${escapeHtml(state.label)}</div>
  <h1 style="margin:14px 0 4px;font-size:20px;line-height:28px;color:#0f172a;">${escapeHtml(displayName)}</h1>
  <p style="margin:0 0 16px;font-size:14px;color:#475569;">của <b style="color:#0f172a;">${escapeHtml(employee.name)}</b> (${escapeHtml(employee.code)})</p>
</td></tr>
<tr><td style="padding:0 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">${tableRows}</table>
  ${button}
</td></tr>
<tr><td style="padding:20px 24px;font-size:12px;line-height:18px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:16px;">
  Email tự động từ hệ thống quản lý nhân sự Thiên Nhật Minh. Vui lòng gia hạn chứng chỉ và cập nhật bản mới vào hồ sơ trước ngày hết hạn.
</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: `Nhắc hạn chứng chỉ ${displayName} · ${employee.name} (${employee.code}) · ${state.short}`, text, html };
}
