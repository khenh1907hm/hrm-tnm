"use client";
import { useCallback, useEffect, useState } from "react";
import { Bug, CheckCircle2, ExternalLink, ImagePlus, RotateCcw } from "lucide-react";
import { dispatchNotificationEmails } from "../../lib/approvalEmailDispatch";
import { getSupabaseClient } from "../../lib/supabase/client";
import { storageName } from "./purchases/purchaseFiles";
import type { Notify } from "./Toast";

/**
 * Báo lỗi / góp ý: mọi tài khoản gửi từ nút tài khoản góc phải (kèm trang đang mở và ảnh chụp màn hình nếu có).
 * Admin nhận thông báo (chuông, email) và xử lý ở trang "Báo lỗi".
 */
type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const BUCKET = "bug-files";

export type BugReport = { id: string; reporterName: string; reporterEmail: string; pageUrl: string; message: string; screenshotPath: string; status: "open" | "done"; adminNote: string; createdAt: string; resolvedAt: string | null };
const fromRow = (row: Row): BugReport => ({
  id: str(row.id), reporterName: str(row.reporter_name), reporterEmail: str(row.reporter_email), pageUrl: str(row.page_url), message: str(row.message),
  screenshotPath: str(row.screenshot_path), status: str(row.status) === "done" ? "done" : "open", adminNote: str(row.admin_note), createdAt: str(row.created_at), resolvedAt: row.resolved_at ? str(row.resolved_at) : null,
});
const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Hộp gửi báo lỗi. */
export function BugReportModal(props: { onClose: () => void; onSent: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    const client = getSupabaseClient();
    if (!client) { setError("Chỉ gửi được khi đã đăng nhập."); return; }
    if (message.trim().length < 3) { setError("Mô tả lỗi ít nhất 3 ký tự."); return; }
    if (file && file.size > 10 * 1024 * 1024) { setError("Ảnh lớn hơn 10 MB."); return; }
    setBusy(true); setError("");
    try {
      const { data, error: insertError } = await client.from("bug_reports")
        .insert({ message: message.trim(), page_url: window.location.pathname + window.location.search, user_agent: navigator.userAgent.slice(0, 300) })
        .select("id").single();
      if (insertError || !data) throw new Error(insertError?.message ?? "Không gửi được.");
      const id = str((data as Row).id);
      if (file) {
        const path = `${id}/${Date.now()}-${storageName(file.name)}`;
        const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { ...(file.type ? { contentType: file.type } : {}) });
        if (!uploadError) await client.from("bug_reports").update({ screenshot_path: path }).eq("id", id);
      }
      dispatchNotificationEmails();
      props.onSent("Đã gửi báo lỗi tới Admin. Cảm ơn bạn!");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không gửi được, thử lại."); setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bug-title" style={{ maxWidth: 560 }}>
        <header><h2 id="bug-title"><Bug className="ico" size={18} aria-hidden="true" /> Báo lỗi / góp ý</h2><button type="button" className="close" aria-label="Đóng" onClick={props.onClose}>×</button></header>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          <label className="field"><span>Bạn gặp lỗi gì, ở bước nào? *</span>
            <textarea rows={5} value={message} autoFocus maxLength={4000} placeholder="Ví dụ: Bấm Lưu và gửi ký ở Confirm Contract thì báo lỗi ..." onChange={(event) => setMessage(event.target.value)} />
            <small className="field-hint">Trang đang mở được gửi kèm: {typeof window === "undefined" ? "" : window.location.pathname}</small>
          </label>
          <label className="button bug-shot"><ImagePlus size={16} aria-hidden="true" /> {file ? file.name : "Đính ảnh chụp màn hình (không bắt buộc)"}
            <input type="file" accept="image/*" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => void send()}>{busy ? "Đang gửi…" : "Gửi báo lỗi"}</button></footer>
      </section>
    </div>
  );
}

/** Trang Admin "Báo lỗi": xem, mở ảnh, đánh dấu đã xử lý (kèm ghi chú). */
export function BugReportsPage(props: { setNotice: Notify }) {
  const { setNotice } = props;
  const [items, setItems] = useState<BugReport[] | null>(null);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const load = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.from("bug_reports").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(fromRow);
  }, []);
  useEffect(() => {
    let active = true;
    void load().then((list) => { if (active) setItems(list); }, (error: unknown) => { if (active) { setNotice(error instanceof Error ? error.message : "Không tải được.", "error"); setItems([]); } });
    return () => { active = false; };
  }, [load, setNotice]);
  const setStatus = async (item: BugReport, status: "open" | "done") => {
    const client = getSupabaseClient();
    if (!client) return;
    const note = status === "done" ? window.prompt("Ghi chú cách xử lý (có thể để trống):", item.adminNote) : item.adminNote;
    if (note === null) return;
    const { error } = await client.from("bug_reports").update({ status, admin_note: note.trim() }).eq("id", item.id);
    if (error) { setNotice(error.message, "error"); return; }
    setNotice(status === "done" ? "Đã đánh dấu đã xử lý." : "Đã mở lại.", "success");
    setItems(await load());
  };
  const openShot = async (item: BugReport) => {
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.storage.from(BUCKET).createSignedUrl(item.screenshotPath, 600);
    if (data) window.open(data.signedUrl, "_blank", "noopener"); else setNotice("Không mở được ảnh.", "error");
  };
  const shown = (items ?? []).filter((item) => filter === "all" || item.status === filter);
  const openCount = (items ?? []).filter((item) => item.status === "open").length;
  return (
    <section className="pj-page">
      <div className="page-head"><div><h1><Bug className="ico" size={22} aria-hidden="true" /> Báo lỗi</h1><p>Lỗi, góp ý người dùng gửi từ nút tài khoản góc phải. Mỗi báo lỗi mới đều báo về chuông (và email nếu đã đặt).</p></div></div>
      <div className="pj-tabs" role="tablist" aria-label="Lọc báo lỗi">
        <button type="button" role="tab" aria-selected={filter === "open"} onClick={() => setFilter("open")}>Chưa xử lý ({openCount})</button>
        <button type="button" role="tab" aria-selected={filter === "done"} onClick={() => setFilter("done")}>Đã xử lý</button>
        <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>Tất cả</button>
      </div>
      {!items ? <div className="loading">Đang tải…</div> : !shown.length ? <div className="panel empty-state"><p>Không có báo lỗi nào.</p></div> : (
        <div className="bug-list">
          {shown.map((item) => (
            <article key={item.id} className={`panel bug-item ${item.status}`}>
              <div className="bug-head">
                <b>{item.reporterName || item.reporterEmail || "Người dùng"}</b>
                <small className="muted">{item.reporterEmail} · {when(item.createdAt)}</small>
                <span className={`pill ${item.status === "done" ? "ok" : "warn"}`}>{item.status === "done" ? "Đã xử lý" : "Chưa xử lý"}</span>
              </div>
              <p className="bug-msg">{item.message}</p>
              <div className="button-row">
                {item.pageUrl.startsWith("/") && !item.pageUrl.startsWith("//") && <a className="link-button" href={item.pageUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" /> {item.pageUrl}</a>}
                {item.screenshotPath && <button type="button" className="link-button" onClick={() => void openShot(item)}>Xem ảnh chụp</button>}
              </div>
              {item.adminNote && <p className="muted"><small>Ghi chú xử lý: {item.adminNote}{item.resolvedAt ? ` · ${when(item.resolvedAt)}` : ""}</small></p>}
              <div className="button-row" style={{ justifyContent: "flex-end" }}>
                {item.status === "open"
                  ? <button type="button" className="button primary" onClick={() => void setStatus(item, "done")}><CheckCircle2 className="ico" size={15} aria-hidden="true" /> Đã xử lý</button>
                  : <button type="button" className="button" onClick={() => void setStatus(item, "open")}><RotateCcw className="ico" size={15} aria-hidden="true" /> Mở lại</button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
