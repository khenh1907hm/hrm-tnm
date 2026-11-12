"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Crown, Mail, UserRound } from "lucide-react";
import { getSupabaseClient } from "../../lib/supabase/client";
import { DOC_TYPE_LABELS, ROLE_LABELS, type ApprovalDocType, type ApprovalRole } from "../../modules/purchases/approval";
import { DOC_PROJECT_TAB } from "../../modules/purchases/store";
import { markNotificationsRead, myAccount, myNotifications, openAppLink, saveNotifySettings, type AppNotification, type MyAccount } from "./accountApi";
import { projectPath, purchasePath } from "./routes";
import "./topbar.css";

type Pending = { stepId: string; docType: ApprovalDocType; title: string; projectCode: string; role: ApprovalRole; targetDate: string; link: string };

const ROLE_NAMES: Record<string, string> = { admin: "Quản trị", hr: "Nhân sự", engineer: "Kỹ sư", employee: "Nhân viên", pending: "Chờ cấp quyền" };
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function loadPending(): Promise<Pending[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc("my_approvals");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const docType = String(row.doc_type) as ApprovalDocType;
    const docId = String(row.doc_id);
    const projectId = row.project_id ? String(row.project_id) : "";
    const link = docType === "purchase" ? purchasePath(docId)
      : docType === "payment" ? purchasePath(String(row.order_id ?? docId))
      : projectId ? `${projectPath(projectId)}?muc=${DOC_PROJECT_TAB[docType] ?? ""}` : "";
    return { stepId: String(row.step_id), docType, title: String(row.title ?? ""), projectCode: String(row.project_code ?? ""), role: String(row.role) as ApprovalRole, targetDate: String(row.target_date ?? ""), link };
  });
}

/**
 * Góc phải trên cùng: chuông thông báo (phiếu chờ tôi duyệt + thông báo trả về / đã duyệt) và hồ sơ
 * (tên, vai trò, Giám đốc, email nhận thông báo). Chỉ hiện ở chế độ thật (có Supabase).
 */
export function TopBarActions(props: { compact?: boolean }) {
  const live = getSupabaseClient() !== null;
  const [open, setOpen] = useState<"bell" | "profile" | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [account, setAccount] = useState<MyAccount | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [nextPending, nextItems] = await Promise.all([loadPending(), myNotifications(30).catch(() => [])]);
    setPending(nextPending);
    setItems(nextItems);
  }, []);

  useEffect(() => {
    if (!live) return;
    let active = true;
    void myAccount().then((value) => { if (active) setAccount(value); });
    const tick = () => { if (active && document.visibilityState === "visible") void refresh(); };
    tick();
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [live, refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(null); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!live) return null;
  // Thông báo "cần duyệt" đã có trong danh sách phiếu chờ: chuông chỉ đếm phiếu chờ + thông báo khác chưa đọc
  const unreadOther = items.filter((item) => !item.readAt && item.kind !== "approval_pending").length;
  const count = pending.length + unreadOther;
  const initials = (account?.fullName || account?.loginEmail || "?").split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase();

  const go = (link: string, ids: string[] = []) => {
    setOpen(null);
    if (ids.length) void markNotificationsRead(ids).then(refresh);
    openAppLink(link);
  };

  return (
    <div className={`top-actions${props.compact ? " compact" : ""}`} ref={boxRef}>
      <button type="button" className="top-icon" aria-label={count ? `Thông báo: ${count} mục mới` : "Thông báo"} aria-expanded={open === "bell"}
        onClick={() => { setOpen(open === "bell" ? null : "bell"); if (open !== "bell") void refresh(); }}>
        <Bell size={20} aria-hidden="true" />
        {count > 0 && <span className="top-badge">{count > 99 ? "99+" : count}</span>}
      </button>
      <button type="button" className="top-icon top-avatar" aria-label="Hồ sơ và email nhận thông báo" aria-expanded={open === "profile"} onClick={() => setOpen(open === "profile" ? null : "profile")}>
        {account ? <span>{initials}</span> : <UserRound size={20} aria-hidden="true" />}
        {account?.isDirector && <Crown className="top-crown" size={12} aria-hidden="true" />}
      </button>

      {open === "bell" && (
        <div className="top-pop" role="dialog" aria-label="Thông báo">
          <header><b>Thông báo</b>{items.some((item) => !item.readAt) && <button type="button" className="link-button" onClick={() => void markNotificationsRead(null).then(refresh)}><CheckCheck size={14} aria-hidden="true" /> Đã đọc hết</button>}</header>
          <h4>Cần bạn duyệt {pending.length > 0 && <span className="pill warn">{pending.length}</span>}</h4>
          {!pending.length ? <p className="muted top-empty">Không có phiếu nào đang chờ bạn ký.</p> : (
            <ul className="top-list">
              {pending.map((item) => {
                const ids = items.filter((note) => !note.readAt && note.link === item.link).map((note) => note.id);
                return (
                  <li key={item.stepId}>
                    <button type="button" className="top-item pending" onClick={() => go(item.link, ids)}>
                      <b>{DOC_TYPE_LABELS[item.docType]}</b>
                      <span>{[item.projectCode, item.title].filter(Boolean).join(" · ")}</span>
                      <small className="muted">Ký với vai trò {ROLE_LABELS[item.role]}{item.targetDate ? ` · hạn ${dmy(item.targetDate)}` : ""}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <h4>Gần đây</h4>
          {!items.length ? <p className="muted top-empty">Chưa có thông báo.</p> : (
            <ul className="top-list">
              {items.slice(0, 15).map((item) => (
                <li key={item.id}>
                  <button type="button" className={`top-item${item.readAt ? "" : " unread"}`} onClick={() => go(item.link, [item.id])}>
                    <b>{item.title}</b>
                    {item.body && <span>{item.body}</span>}
                    <small className="muted">{when(item.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {account && !account.notifyEmail && <p className="top-hint"><Mail size={14} aria-hidden="true" /> Chưa đặt email nhận thông báo. <button type="button" className="link-button" onClick={() => setOpen("profile")}>Đặt ngay</button></p>}
        </div>
      )}

      {open === "profile" && <ProfilePop key={account ? "ready" : "loading"} account={account} onSaved={(next) => setAccount(next)} />}
    </div>
  );
}

function ProfilePop(props: { account: MyAccount | null; onSaved: (account: MyAccount | null) => void }) {
  const { account } = props;
  const [email, setEmail] = useState(account?.notifyEmail ?? "");
  const [enabled, setEnabled] = useState(account?.notifyEnabled ?? true);
  const [state, setState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: "", error: false });
  if (!account) return <div className="top-pop" role="dialog" aria-label="Hồ sơ"><p className="muted top-empty">Đang tải hồ sơ…</p></div>;
  const save = async () => {
    const value = email.trim();
    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { setState({ busy: false, message: "Email chưa đúng dạng (vd ten@congty.com).", error: true }); return; }
    setState({ busy: true, message: "", error: false });
    try {
      await saveNotifySettings(value, enabled);
      props.onSaved(await myAccount());
      setState({ busy: false, message: value ? `Đã lưu. Thông báo duyệt sẽ gửi tới ${value}.` : "Đã lưu. Bạn chỉ nhận thông báo trên chuông.", error: false });
    } catch (error) {
      setState({ busy: false, message: error instanceof Error && /NOTIFY_EMAIL_INVALID/.test(error.message) ? "Email chưa đúng dạng." : "Không lưu được, thử lại.", error: true });
    }
  };
  return (
    <div className="top-pop" role="dialog" aria-label="Hồ sơ">
      <div className="top-profile-head">
        <span className="top-avatar-lg">{(account.fullName || "?").split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join("").toUpperCase()}</span>
        <span>
          <b>{account.fullName || account.loginEmail}</b>
          <small className="muted">{account.loginEmail}</small>
          <span className="button-row">
            {account.isDirector && <span className="pill ok"><Crown size={12} aria-hidden="true" /> Giám đốc</span>}
            <span className="pill">{ROLE_NAMES[account.role] ?? account.role}</span>
          </span>
        </span>
      </div>
      {account.isDirector && <p className="top-hint">Quyền Giám đốc: ký thay mọi bước và bấm “Duyệt ngay” để duyệt phiếu không cần chờ các bước trước.</p>}
      <form className="top-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="field"><span>Email nhận thông báo duyệt</span>
          <input type="email" value={email} placeholder="ten@congty.com" autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
          <small className="field-hint">Để trống thì chỉ nhận thông báo trên chuông.</small>
        </label>
        <label className="toolbar-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Gửi email khi có phiếu cần tôi duyệt, bị trả về hoặc đã duyệt</label>
        {state.message && <p className={state.error ? "form-error" : "muted"} role="status">{state.message}</p>}
        <button type="submit" className="button primary" disabled={state.busy}>{state.busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </div>
  );
}
