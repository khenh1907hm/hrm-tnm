import { FileSpreadsheet, Send } from "lucide-react";
import { useState } from "react";
import { buildExpiringCertificatesWorkbook } from "../../modules/exports/expiringCertificates";
import type { Actor } from "../../modules/auth/permissions";
import { getSupabaseClient } from "../../lib/supabase/client";
import { downloadXlsx } from "./profileExport";
import { issueText, type App, type ExpiringCertificateRow, type SetNotice } from "./shared";

type AlertFilter = "all" | "expired" | "d30" | "d60";
const FILTER_TITLES: Record<AlertFilter, { title: string; file: string }> = {
  all: { title: "Chứng chỉ hết hạn và sắp hết hạn", file: "TatCa" },
  expired: { title: "Chứng chỉ đã hết hạn", file: "DaHetHan" },
  d30: { title: "Chứng chỉ hết hạn trong 30 ngày", file: "Trong30Ngay" },
  d60: { title: "Chứng chỉ hết hạn trong 31 đến 60 ngày", file: "31Den60Ngay" },
};
/** Ngày hôm nay theo giờ Việt Nam, dạng yyyy-mm-dd. */
const todayVn = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

export function AlertsView(props: { app: App; actor: Actor; certRows: ExpiringCertificateRow[]; onCertRowsChange: (rows: ExpiringCertificateRow[]) => void; onOpenEmployee: (employeeId: string) => void; setNotice: SetNotice }) {
  const { app, actor, certRows, setNotice } = props;
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Có Supabase thì gửi email thật qua máy chủ; chế độ demo chỉ giả lập
  const live = getSupabaseClient() !== null;

  /** Gửi thẳng email nhắc hạn cho các chứng chỉ đến hạn (bản demo chỉ đánh dấu đã gửi giả lập). */
  const sendNotifications = async () => {
    const [due, settings] = await Promise.all([app.reminders.computeDue(actor), app.settings.get(actor)]);
    if (!due.ok) { setNotice(issueText(due.errors[0]?.code ?? "FORBIDDEN")); return; }
    if (!settings.ok || !settings.value.reminderEmails.length) { setNotice("Chưa có địa chỉ nhận. Thêm ở Cài đặt email."); return; }
    if (!due.value.length) { setNotice("Không có chứng chỉ nào đến hạn gửi nhắc. Các chứng chỉ trong danh sách đã được gửi hoặc chưa tới ngày gửi."); return; }
    await (live ? sendRemindersNow() : markRemindersSent());
  };

  const refreshRows = async () => {
    const updated = await app.certificates.listExpiring(actor);
    if (updated.ok) props.onCertRowsChange(updated.value);
  };

  const sendRemindersNow = async () => {
    setSending(true);
    try {
      const session = await getSupabaseClient()?.auth.getSession();
      const token = session?.data.session?.access_token;
      const response = await fetch("/api/reminders/run", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; sent?: string[]; failed?: unknown[]; skipped?: unknown[] } | null;
      if (!response.ok || !body?.ok) { setNotice(body?.message ?? "Không gửi được email nhắc hạn."); return; }
      const failed = body.failed?.length ?? 0;
      setNotice(failed ? `Đã gửi ${body.sent?.length ?? 0} email, ${failed} email lỗi. Kiểm tra cấu hình SMTP.` : `Đã gửi ${body.sent?.length ?? 0} email thông báo tới hộp thư nhận nhắc hạn.`, failed ? undefined : "success");
      await refreshRows();
    } catch { setNotice("Không kết nối được máy chủ để gửi email."); }
    finally { setSending(false); }
  };

  const markRemindersSent = async () => {
    const settings = await app.settings.get(actor);
    if (!settings.ok || !settings.value.reminderEmails.length) { setNotice("Chưa có địa chỉ nhận."); return; }
    const result = await app.reminders.run(actor);
    if (!result.ok) { setNotice(issueText(result.errors[0]?.code ?? "FORBIDDEN")); return; }
    setNotice(`Đã đánh dấu ${result.value.sent.length} email là đã gửi giả lập. Chưa gửi email thật.`);
    await refreshRows();
  };

  const visibleRows = certRows.filter((item) => alertFilter === "all" || (alertFilter === "expired" && item.group === "expired") || (alertFilter === "d30" && item.daysLeft >= 0 && item.daysLeft <= 30) || (alertFilter === "d60" && item.daysLeft >= 31 && item.daysLeft <= 60));

  const exportExcel = async () => {
    setExporting(true);
    try {
      const today = todayVn();
      const bytes = await buildExpiringCertificatesWorkbook(visibleRows, { today, title: FILTER_TITLES[alertFilter].title, exportedBy: actor.id });
      downloadXlsx(bytes, `ChungChiHetHan_${FILTER_TITLES[alertFilter].file}_${today.replaceAll("-", "")}.xlsx`);
    } catch { setNotice("Không tạo được tệp Excel."); }
    finally { setExporting(false); }
  };

  return <>
    <div className="page-head"><div><h1>Chứng chỉ hết hạn và sắp hết hạn</h1><p>{live ? "Email nhắc hạn tự gửi lúc 8:00 sáng mỗi ngày" : "Giả lập, chưa gửi email thật"}</p></div><div className="button-row">
      <button className="button" disabled={exporting || !visibleRows.length} title={visibleRows.length ? "Xuất đúng các dòng đang lọc" : "Không có chứng chỉ nào để xuất"} onClick={() => void exportExcel()}><FileSpreadsheet className="ico" size={16} aria-hidden="true" /> {exporting ? "Đang xuất…" : `Xuất Excel (${visibleRows.length})`}</button>
      {actor.role === "admin" && <button className="button primary" disabled={sending} onClick={() => void sendNotifications()}><Send className="ico" size={16} aria-hidden="true" /> {sending ? "Đang gửi…" : live ? "Gửi mail thông báo" : "Gửi mail thông báo (giả lập)"}</button>}
    </div></div>
    <div className="alert-filters"><button className="button" aria-pressed={alertFilter === "all"} onClick={() => setAlertFilter("all")}>Tất cả ({certRows.length})</button><button className="button" aria-pressed={alertFilter === "expired"} onClick={() => setAlertFilter("expired")}>Đã hết hạn ({certRows.filter((item) => item.group === "expired").length})</button><button className="button" aria-pressed={alertFilter === "d30"} onClick={() => setAlertFilter("d30")}>Trong 30 ngày ({certRows.filter((item) => item.daysLeft >= 0 && item.daysLeft <= 30).length})</button><button className="button" aria-pressed={alertFilter === "d60"} onClick={() => setAlertFilter("d60")}>31 đến 60 ngày ({certRows.filter((item) => item.daysLeft >= 31 && item.daysLeft <= 60).length})</button></div>
    <div className="panel table-scroll"><table><thead><tr><th>Nhân sự</th><th>Chứng chỉ</th><th>Ngày hết hạn</th><th>Số ngày còn lại</th><th>Email nhắc</th></tr></thead><tbody>{visibleRows.map((item) => <tr key={item.id} onClick={() => props.onOpenEmployee(item.employeeId)}><td>{item.employeeName} ({item.employeeCode})</td><td>{item.displayName}</td><td>{item.expiryDate}</td><td><span className={item.daysLeft < 0 ? "pill bad" : item.daysLeft <= 30 ? "pill warn" : "pill ok"}>{item.daysLeft}</span></td><td>{item.reminderSent ? `${live ? "Đã gửi" : "Đã gửi giả lập"} ngày ${item.reminderSentDate ?? item.reminderSendDate}` : `Sẽ gửi ngày ${item.reminderSendDate}`}</td></tr>)}</tbody></table></div>
  </>;
}
