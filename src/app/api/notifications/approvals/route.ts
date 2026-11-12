import { createClient } from "@supabase/supabase-js";
import { createSmtpMailer } from "../../../../lib/mailer/smtpMailer";

/**
 * Gửi email cho thông báo duyệt mới (bảng user_notifications, emailed_at còn trống) tới email nhận thông báo
 * mà mỗi người tự đặt ở góc phải (hồ sơ). Người chưa đặt email hoặc tắt nhận email thì chỉ thấy trên chuông.
 *  - POST: người đăng nhập gọi sau khi gửi / ký phiếu (Bearer token Supabase).
 *  - GET: lịch chạy gọi kèm `Authorization: Bearer CRON_SECRET` để gửi bù.
 */
export const maxDuration = 60;

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !token) return false;
  const { data, error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.getUser(token);
  return !error && Boolean(data.user);
}

async function run(request: Request) {
  if (!(await authorized(request))) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return Response.json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, { status: 503 });
  const mailer = createSmtpMailer({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: rows, error } = await admin.from("user_notifications").select("id, user_id, title, body, link, created_at")
    .is("emailed_at", null).gte("created_at", since).order("created_at").limit(100);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, sent: 0 });

  const userIds = Array.from(new Set(rows.map((row) => String(row.user_id))));
  const { data: profiles } = await admin.from("profiles").select("id, full_name, notify_email, notify_enabled").in("id", userIds);
  const byUser = new Map((profiles ?? []).map((profile) => [String(profile.id), profile]));
  const base = (process.env.APP_BASE_URL ?? "https://tnm.com.vn").replace(/\/$/, "");
  let sent = 0;
  const done: string[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    const profile = byUser.get(String(row.user_id));
    const to = String(profile?.notify_email ?? "").trim();
    if (!mailer || !to || profile?.notify_enabled === false) { if (mailer || !to) done.push(String(row.id)); continue; }
    const link = row.link ? `${base}${String(row.link)}` : base;
    const title = String(row.title);
    const body = String(row.body ?? "");
    try {
      await mailer.send({
        to: [to],
        subject: `[TNM] ${title}`,
        text: `Chào ${profile?.full_name ?? ""},\n\n${title}\n${body}\n\nMở phiếu: ${link}\n\n— Quản trị Online TNM`,
        html: `<p>Chào ${escapeHtml(String(profile?.full_name ?? ""))},</p><p><b>${escapeHtml(title)}</b><br>${escapeHtml(body)}</p>`
          + `<p><a href="${escapeHtml(link)}" style="background:#0f766e;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Mở phiếu để duyệt</a></p>`
          + `<p style="color:#64748b;font-size:12px">Đổi email nhận thông báo: bấm biểu tượng hồ sơ ở góc phải trên Quản trị Online TNM.</p>`,
      });
      sent += 1;
      done.push(String(row.id));
    } catch { failed.push(String(row.id)); }
  }
  if (done.length) await admin.from("user_notifications").update({ emailed_at: new Date().toISOString() }).in("id", done);
  return Response.json({ ok: true, sent, skipped: done.length - sent, failed: failed.length, mailer: Boolean(mailer) });
}

export async function POST(request: Request) { return run(request); }
export async function GET(request: Request) { return run(request); }
