import nodemailer from "nodemailer";
import type { Mailer } from "../../app-core/context";

export type SmtpEnv = { host?: string | undefined; port?: string | undefined; user?: string | undefined; pass?: string | undefined; from?: string | undefined };

/** Mailer gửi qua SMTP (Gmail, Outlook, Resend SMTP...). Trả về null khi thiếu cấu hình. */
export function createSmtpMailer(env: SmtpEnv): Mailer | null {
  if (!env.host || !env.user || !env.pass) return null;
  const port = Number(env.port ?? 465);
  // Mật khẩu ứng dụng Gmail hiện theo nhóm "abcd efgh ijkl mnop": bỏ dấu cách khi dán nguyên
  const transport = nodemailer.createTransport({ host: env.host, port, secure: port === 465, auth: { user: env.user.trim(), pass: env.pass.replace(/\s+/g, "") } });
  const from = env.from || { name: "Thiên Nhật Minh - Quản lý nhân sự", address: env.user.trim() };
  return {
    async send(message) {
      try {
        await transport.sendMail({ from, to: message.to.join(", "), subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) });
      } catch (error) {
        // Ghi lý do ở máy chủ (vd 535 sai tài khoản / mật khẩu ứng dụng); giao diện chỉ báo gửi lỗi
        const detail = error as { code?: string; responseCode?: number; message?: string };
        console.error(`[smtp] Gửi email lỗi: ${detail.code ?? ""} ${detail.responseCode ?? ""} ${detail.message ?? String(error)}`.trim());
        throw error;
      }
    },
  };
}
