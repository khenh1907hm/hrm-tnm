import nodemailer from "nodemailer";
import type { Mailer } from "../../app-core/context";

export type SmtpEnv = { host?: string | undefined; port?: string | undefined; user?: string | undefined; pass?: string | undefined; from?: string | undefined };

/** Mailer gửi qua SMTP (Gmail, Outlook, Resend SMTP...). Trả về null khi thiếu cấu hình. */
export function createSmtpMailer(env: SmtpEnv): Mailer | null {
  if (!env.host || !env.user || !env.pass) return null;
  const port = Number(env.port ?? 465);
  const transport = nodemailer.createTransport({ host: env.host, port, secure: port === 465, auth: { user: env.user, pass: env.pass } });
  const from = env.from || env.user;
  return {
    async send(message) {
      await transport.sendMail({ from, to: message.to.join(", "), subject: message.subject, text: message.text });
    },
  };
}
