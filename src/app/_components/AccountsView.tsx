"use client";
import { Eye, KeyRound, ListChecks, Lock, LockOpen, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCOUNT_ROLES, ACCOUNT_ROLE_LABELS, MIN_PASSWORD_LENGTH, type Account, type AccountRole } from "../../lib/accountAdmin";
import { getSupabaseClient } from "../../lib/supabase/client";
import { ACCESS_ITEMS, ACCESS_KEYS, defaultAccess, effectiveAccess, toggleAccess, type AccessKey, type Actor, type ActorRole } from "../../modules/auth/permissions";
import type { SetNotice } from "./shared";

const ROLE_HINTS: Record<AccountRole, string> = {
  admin: "Toàn quyền, kể cả quản trị tài khoản và xem nhật ký.",
  hr: "Mặc định làm được mọi việc nhân sự, hành chính; trừ quản trị tài khoản và xem nhật ký.",
  engineer: "Mặc định chỉ dùng trang Công cụ và Kho Skill AI; Admin có thể tick thêm việc khác.",
  employee: "Mặc định chỉ dùng Kho Skill AI và trang Công cụ; Admin có thể tick thêm việc khác.",
  pending: "Đăng nhập được nhưng chưa xem được gì.",
};
const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const ACCESS_GROUPS = [...new Set(ACCESS_ITEMS.map((item) => item.group))];
const sameAccess = (a: readonly AccessKey[], b: readonly AccessKey[]) => a.length === b.length && a.every((key) => b.includes(key));

/** Tóm tắt quyền hiện ở bảng tài khoản. */
function accessSummary(account: Account): string {
  if (account.role === "admin") return "Toàn quyền";
  if (account.role === "pending") return "Chưa có quyền";
  if (!account.permissions) return "Theo vai trò";
  return `Tùy chỉnh · ${effectiveAccess(account.role, account.permissions).length}/${ACCESS_KEYS.length} mục`;
}

const DEMO_ACCOUNT_BASE = { createdAt: "2026-10-01T02:00:00Z", lastSignInAt: null, locked: false };
/** Tài khoản mẫu của bản demo: chỉ sống trong phiên, để xem thử cách phân quyền. */
const DEMO_ACCOUNTS: Account[] = [
  { ...DEMO_ACCOUNT_BASE, id: "demo-admin", email: "admin@demo.local", fullName: "Admin mẫu", role: "admin", permissions: null },
  { ...DEMO_ACCOUNT_BASE, id: "demo-hr", email: "nhansu@demo.local", fullName: "Nhân sự mẫu", role: "hr", permissions: null },
  { ...DEMO_ACCOUNT_BASE, id: "demo-engineer", email: "kysu@demo.local", fullName: "Kỹ sư học thêm nhân sự", role: "engineer", permissions: null },
  { ...DEMO_ACCOUNT_BASE, id: "demo-employee", email: "nhanvien@demo.local", fullName: "Nhân viên mẫu", role: "employee", permissions: null },
];

type ApiBody = { ok?: boolean; message?: string; accounts?: Account[]; account?: Account };

async function callApi(method: "GET" | "POST" | "PATCH", body?: unknown): Promise<ApiBody> {
  const session = await getSupabaseClient()?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/admin/accounts", { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const parsed = await response.json().catch(() => null) as ApiBody | null;
  if (!response.ok || !parsed?.ok) throw new Error(parsed?.message ?? "Không kết nối được máy chủ.");
  return parsed;
}

/** Quản trị tài khoản (chỉ admin): thêm tài khoản, đổi vai trò, đặt lại mật khẩu, khóa / mở khóa. */
export function AccountsView(props: { actor: Actor; mode: "demo" | "live"; setNotice: SetNotice; onPreviewActor?: (actor: Actor) => void }) {
  const { actor, setNotice } = props;
  const demo = props.mode === "demo";
  const [accounts, setAccounts] = useState<Account[] | null>(demo ? DEMO_ACCOUNTS : null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [granting, setGranting] = useState<Account | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (props.mode !== "live") return;
    let current = true;
    callApi("GET").then((body) => { if (current) { setAccounts(body.accounts ?? []); setError(null); } })
      .catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : "Không tải được danh sách tài khoản."); });
    return () => { current = false; };
  }, [props.mode, attempt]);

  const change = async (account: Account, patch: { role?: AccountRole; locked?: boolean; password?: string; permissions?: AccessKey[] | null }, done: string) => {
    if (demo) {
      setAccounts((current) => current?.map((item) => item.id === account.id ? { ...item, ...(patch.role ? { role: patch.role } : {}), ...(patch.locked === undefined ? {} : { locked: patch.locked }), ...(patch.permissions === undefined ? {} : { permissions: patch.permissions }) } : item) ?? null);
      setNotice(done);
      return true;
    }
    setBusyId(account.id);
    try {
      const updated = (await callApi("PATCH", { id: account.id, ...patch })).account;
      if (updated) setAccounts((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? null);
      setNotice(done);
      return true;
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Không lưu được."); return false; }
    finally { setBusyId(null); }
  };

  const pending = accounts?.filter((item) => item.role === "pending" && !item.locked).length ?? 0;
  return <>
    <div className="page-head">
      <div><h1>Tài khoản &amp; phân quyền</h1><p>{demo ? "Bản demo: tài khoản mẫu, thay đổi chỉ lưu trong phiên này. Dùng nút Xem thử để xem người đó thấy gì." : "Thêm tài khoản, cấp vai trò, chọn quyền từng người, đặt lại mật khẩu hoặc khóa người đã nghỉ. Mọi thay đổi ghi vào Nhật ký."}</p></div>
      <button type="button" className="button primary" disabled={demo} onClick={() => setCreating(true)}><UserPlus className="ico" size={16} aria-hidden="true" /> Thêm tài khoản</button>
    </div>
    {pending > 0 && <p className="list-notice is-warn">{pending} tài khoản đang chờ cấp quyền: chọn vai trò ở cột Vai trò.</p>}
    <section className="panel">
      {error && <p className="empty">{error} <button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></p>}
      {!error && <div className="table-scroll">
        <table className="accounts-table" aria-busy={accounts === null}>
          <thead><tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Quyền</th><th>Đăng nhập gần nhất</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {accounts === null && <tr><td colSpan={7} className="empty">Đang tải tài khoản…</td></tr>}
            {accounts?.map((account) => {
              const self = account.id === actor.id;
              const busy = busyId === account.id;
              return <tr key={account.id} className={account.locked ? "is-locked" : undefined}>
                <td>{account.email}{self && <span className="pill info">Bạn</span>}</td>
                <td>{account.fullName || <span className="muted">—</span>}</td>
                <td>
                  <select aria-label={`Vai trò của ${account.email}`} value={account.role} disabled={self || busy} title={self ? "Không tự đổi vai trò của mình" : ROLE_HINTS[account.role]}
                    onChange={(event) => { const role = event.target.value as AccountRole; void change(account, { role }, `${account.email}: vai trò mới là ${ACCOUNT_ROLE_LABELS[role]}.`); }}>
                    {ACCOUNT_ROLES.map((role) => <option key={role} value={role}>{ACCOUNT_ROLE_LABELS[role]}</option>)}
                  </select>
                </td>
                <td className="nowrap">
                  {account.role === "admin" || account.role === "pending"
                    ? <span className="muted">{accessSummary(account)}</span>
                    : <button type="button" className="button account-access" disabled={busy} aria-label={`Chọn quyền cho ${account.email}`} onClick={() => setGranting(account)}><ListChecks className="ico" size={15} aria-hidden="true" /> {accessSummary(account)}</button>}
                </td>
                <td className="nowrap">{account.lastSignInAt ? TIME_FORMAT.format(new Date(account.lastSignInAt)) : <span className="muted">Chưa đăng nhập</span>}</td>
                <td>{account.locked ? <span className="pill bad">Đã khóa</span> : <span className="pill ok">Hoạt động</span>}</td>
                <td className="accounts-actions">
                  {demo && !self && account.role !== "admin" && props.onPreviewActor && <button type="button" className="button" onClick={() => props.onPreviewActor?.({ id: account.id, role: account.role as ActorRole, access: effectiveAccess(account.role, account.permissions) })}><Eye className="ico" size={15} aria-hidden="true" /> Xem thử</button>}
                  <button type="button" className="button" disabled={busy} onClick={() => setResetting(account)}><KeyRound className="ico" size={15} aria-hidden="true" /> Đặt lại mật khẩu</button>
                  {!self && (account.locked
                    ? <button type="button" className="button" disabled={busy} onClick={() => void change(account, { locked: false }, `Đã mở khóa ${account.email}.`)}><LockOpen className="ico" size={15} aria-hidden="true" /> Mở khóa</button>
                    : <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm(`Khóa ${account.email}? Người này sẽ không đăng nhập được cho tới khi mở khóa.`)) void change(account, { locked: true }, `Đã khóa ${account.email}.`); }}><Lock className="ico" size={15} aria-hidden="true" /> Khóa</button>)}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </section>
    <section className="panel accounts-roles">
      <h2>Các vai trò</h2>
      <dl>{ACCOUNT_ROLES.map((role) => <div key={role}><dt>{ACCOUNT_ROLE_LABELS[role]}</dt><dd>{ROLE_HINTS[role]}</dd></div>)}</dl>
    </section>
    {creating && <CreateAccountModal onClose={() => setCreating(false)} onCreated={(account) => { setAccounts((current) => [...(current ?? []), account].sort((a, b) => a.email.localeCompare(b.email))); setCreating(false); setNotice(`Đã tạo tài khoản ${account.email}. Gửi email và mật khẩu cho người dùng.`); }} />}
    {granting && <AccessModal account={granting} onClose={() => setGranting(null)} onSave={async (permissions) => { if (await change(granting, { permissions }, `Đã cập nhật quyền của ${granting.email}. Người này tải lại trang hoặc quay lại tab là có hiệu lực.`)) setGranting(null); }} />}
    {resetting && <ResetPasswordModal account={resetting} onClose={() => setResetting(null)} onSave={async (password) => { if (await change(resetting, { password }, `Đã đặt mật khẩu mới cho ${resetting.email}.`)) setResetting(null); }} />}
  </>;
}

function ModalShell(props: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={props.wide ? "modal-card accounts-modal is-wide" : "modal-card accounts-modal"} role="dialog" aria-modal="true" aria-labelledby="accounts-modal-title">
        <header>
          <h2 id="accounts-modal-title">{props.title}</h2>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="accounts-modal-body">{props.children}</div>
        <footer>{props.footer}</footer>
      </section>
    </div>
  );
}

function CreateAccountModal(props: { onClose: () => void; onCreated: (account: Account) => void }) {
  const [form, setForm] = useState({ email: "", fullName: "", password: "", role: "hr" as AccountRole });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { const account = (await callApi("POST", form)).account; if (account) props.onCreated(account); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Không tạo được tài khoản."); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Thêm tài khoản" onClose={props.onClose} footer={<>
    <button type="button" className="button" onClick={props.onClose}>Hủy</button>
    <button type="button" className="button primary" disabled={busy || !form.email.trim() || form.password.length < MIN_PASSWORD_LENGTH} onClick={() => void submit()}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</button>
  </>}>
    <label className="field"><span>Email đăng nhập</span><input type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
    <label className="field"><span>Họ tên</span><input type="text" maxLength={100} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
    <label className="field"><span>Mật khẩu ban đầu <small>(tối thiểu {MIN_PASSWORD_LENGTH} ký tự)</small></span><input type="text" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
    <label className="field"><span>Vai trò</span>
      <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AccountRole })}>
        {ACCOUNT_ROLES.map((role) => <option key={role} value={role}>{ACCOUNT_ROLE_LABELS[role]}</option>)}
      </select>
      <small className="field-hint">{ROLE_HINTS[form.role]}</small>
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
  </ModalShell>;
}

/** Chọn từng mục quyền cho một người; khớp đúng mặc định của vai trò thì lưu là "Theo vai trò". */
function AccessModal(props: { account: Account; onClose: () => void; onSave: (permissions: AccessKey[] | null) => Promise<void> }) {
  const { account } = props;
  const roleDefault = defaultAccess(account.role);
  const [selected, setSelected] = useState<AccessKey[]>(() => [...effectiveAccess(account.role, account.permissions)]);
  const [busy, setBusy] = useState(false);
  const followsRole = sameAccess(selected, roleDefault);
  return <ModalShell title={`Chọn quyền · ${account.fullName || account.email}`} wide onClose={props.onClose} footer={<>
    <button type="button" className="button access-reset" disabled={followsRole} onClick={() => setSelected([...roleDefault])}>Về mặc định của vai trò</button>
    <button type="button" className="button" onClick={props.onClose}>Hủy</button>
    <button type="button" className="button primary" disabled={busy} onClick={() => { setBusy(true); void props.onSave(followsRole ? null : selected).finally(() => setBusy(false)); }}>{busy ? "Đang lưu…" : "Lưu quyền"}</button>
  </>}>
    <p className="muted">Vai trò <b>{ACCOUNT_ROLE_LABELS[account.role]}</b> giữ nguyên. Tick thêm để người này làm được việc của bộ phận khác, bỏ tick để thu lại. Quản trị tài khoản và Nhật ký luôn chỉ dành cho Admin; Kho Skill AI luôn mở cho mọi người.</p>
    {ACCESS_GROUPS.map((group) => <fieldset className="access-group" key={group}>
      <legend>{group}</legend>
      {ACCESS_ITEMS.filter((item) => item.group === group).map((item) => <label className="access-item" key={item.key}>
        <input type="checkbox" checked={selected.includes(item.key)} onChange={(event) => setSelected((current) => toggleAccess(current, item.key, event.target.checked))} />
        <span><b>{item.label}</b><small>{item.hint}</small></span>
      </label>)}
    </fieldset>)}
  </ModalShell>;
}

function ResetPasswordModal(props: { account: Account; onClose: () => void; onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return <ModalShell title={`Đặt lại mật khẩu · ${props.account.email}`} onClose={props.onClose} footer={<>
    <button type="button" className="button" onClick={props.onClose}>Hủy</button>
    <button type="button" className="button primary" disabled={busy || password.length < MIN_PASSWORD_LENGTH} onClick={() => { setBusy(true); void props.onSave(password).finally(() => setBusy(false)); }}>{busy ? "Đang lưu…" : "Lưu mật khẩu mới"}</button>
  </>}>
    <label className="field"><span>Mật khẩu mới <small>(tối thiểu {MIN_PASSWORD_LENGTH} ký tự)</small></span><input type="text" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <p className="muted">Người dùng đăng nhập lại bằng mật khẩu này; mật khẩu cũ hết hiệu lực ngay.</p>
  </ModalShell>;
}
