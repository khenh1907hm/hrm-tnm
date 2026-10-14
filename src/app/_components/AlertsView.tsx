import { useState } from "react";
import type { Actor } from "../../modules/auth/permissions";
import { reminderEmail } from "../../modules/reminders/email";
import { issueText, type App, type ExpiringCertificateRow, type SetNotice } from "./shared";

type AlertFilter = "all" | "expired" | "d30" | "d60";

export function AlertsView(props: { app: App; actor: Actor; certRows: ExpiringCertificateRow[]; onCertRowsChange: (rows: ExpiringCertificateRow[]) => void; onOpenEmployee: (employeeId: string) => void; setNotice: SetNotice }) {
  const { app, actor, certRows, setNotice } = props;
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [reminderPreview, setReminderPreview] = useState<{ recipients: string[]; subject: string; text: string }[]>([]);

  const runReminders = async () => {
    const [due, settings, types] = await Promise.all([app.reminders.computeDue(actor), app.settings.get(actor), app.certificateTypes.list(actor)]);
    if (!due.ok) { setNotice(issueText(due.errors[0]?.code ?? "FORBIDDEN")); return; }
    if (!settings.ok || !settings.value.reminderEmails.length) { setReminderPreview([]); setNotice("Chưa có địa chỉ nhận."); return; }
    if (!due.value.length) { setReminderPreview([]); setNotice("Không có email nhắc hạn cần gửi."); return; }
    const messages = due.value.map((item) => {
      const category = types.ok ? types.value.find((type) => type.key === item.certificate.type) : undefined;
      return { recipients: settings.value.reminderEmails, ...reminderEmail(item.employee, item.certificate, item.daysLeft, `/nhan-su/${item.employee.id}`, category) };
    });
    setReminderPreview(messages);
    setNotice(`Đã chuẩn bị ${messages.length} email giả lập. Chưa gửi email thật.`);
  };

  const markRemindersSent = async () => {
    const settings = await app.settings.get(actor);
    if (!settings.ok || !settings.value.reminderEmails.length) { setNotice("Chưa có địa chỉ nhận."); return; }
    const result = await app.reminders.run(actor);
    if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "FORBIDDEN")); return; }
    setNotice(`Đã đánh dấu ${result.value.sent.length} email là đã gửi giả lập. Chưa gửi email thật.`);
    setReminderPreview([]);
    const updated = await app.certificates.listExpiring(actor);
    if (updated.ok) props.onCertRowsChange(updated.value);
  };

  const visibleRows = certRows.filter((item) => alertFilter === "all" || (alertFilter === "expired" && item.group === "expired") || (alertFilter === "d30" && item.daysLeft >= 0 && item.daysLeft <= 30) || (alertFilter === "d60" && item.daysLeft >= 31 && item.daysLeft <= 60));

  return <>
    <div className="page-head"><div><h1>Chứng chỉ hết hạn và sắp hết hạn</h1><p>Giả lập, chưa gửi email thật</p></div>{actor.role === "admin" && <button className="button primary" onClick={() => void runReminders()}>Chạy nhắc hạn thử</button>}</div>
    <div className="alert-filters"><button className="button" onClick={() => setAlertFilter("all")}>Tất cả ({certRows.length})</button><button className="button" onClick={() => setAlertFilter("expired")}>Đã hết hạn ({certRows.filter((item) => item.group === "expired").length})</button><button className="button" onClick={() => setAlertFilter("d30")}>Trong 30 ngày ({certRows.filter((item) => item.daysLeft >= 0 && item.daysLeft <= 30).length})</button><button className="button" onClick={() => setAlertFilter("d60")}>31 đến 60 ngày ({certRows.filter((item) => item.daysLeft >= 31 && item.daysLeft <= 60).length})</button></div>
    <div className="panel table-scroll"><table><thead><tr><th>Nhân sự</th><th>Chứng chỉ</th><th>Ngày hết hạn</th><th>Số ngày còn lại</th><th>Email nhắc</th></tr></thead><tbody>{visibleRows.map((item) => <tr key={item.id} onClick={() => props.onOpenEmployee(item.employeeId)}><td>{item.employeeName} ({item.employeeCode})</td><td>{item.displayName}</td><td>{item.expiryDate}</td><td><span className={item.daysLeft < 0 ? "pill bad" : item.daysLeft <= 30 ? "pill warn" : "pill ok"}>{item.daysLeft}</span></td><td>{item.reminderSent ? `Đã gửi giả lập ngày ${item.reminderSentDate ?? item.reminderSendDate}` : `Sẽ gửi ngày ${item.reminderSendDate}`}</td></tr>)}</tbody></table></div>
    {reminderPreview.length > 0 && <section className="panel detail-panel"><h2>Email nhắc hạn dự kiến</h2>{reminderPreview.map((email, index) => <article className="email-preview" key={`${email.subject}-${index}`}><b>Người nhận: {email.recipients.join(", ")}</b><h3>{email.subject}</h3><pre>{email.text}</pre></article>)}{actor.role === "admin" && <button className="button primary" onClick={() => void markRemindersSent()}>Đánh dấu đã gửi (giả lập)</button>}</section>}
  </>;
}
