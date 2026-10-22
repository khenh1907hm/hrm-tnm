import { useState, type FormEvent } from "react";
import { Clock, LogIn, LogOut } from "lucide-react";

/** Đăng nhập bằng email + mật khẩu (tài khoản do quản trị tạo trong Supabase). */
export function LoginScreen(props: { onSignIn: (email: string, password: string) => Promise<string | null> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) { setError("Nhập email và mật khẩu."); return; }
    setBusy(true); setError("");
    const message = await props.onSignIn(email.trim(), password);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <main className="login-page">
      <form className="login-card panel" onSubmit={(event) => void submit(event)} noValidate>
        <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div></div>
        <h1>Đăng nhập</h1>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={error ? "login-error" : undefined} /></label>
        <label className="field"><span>Mật khẩu</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p id="login-error" className="form-error" role="alert">{error}</p>}
        <button type="submit" className="button primary" disabled={busy}><LogIn className="ico" size={16} aria-hidden="true" /> {busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        <p className="muted login-hint">Tài khoản do quản trị viên cấp. Liên hệ Admin nếu quên mật khẩu.</p>
      </form>
    </main>
  );
}

/** Tài khoản đã đăng nhập nhưng chưa được cấp quyền: không hiển thị dữ liệu nào. */
export function PendingAccessScreen(props: { email: string | null; onSignOut: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card panel">
        <div className="brand"><div className="brand-mark">TNM</div><div><b>Thiên Nhật Minh</b><span>Quản lý nhân sự</span></div></div>
        <h1><Clock className="ico" size={20} aria-hidden="true" /> Chờ cấp quyền</h1>
        <p>Tài khoản <b>{props.email ?? "này"}</b> đã đăng nhập nhưng chưa được cấp quyền truy cập dữ liệu nhân sự.</p>
        <p className="muted">Hãy báo Admin cấp vai trò Nhân viên, HR hoặc Admin cho tài khoản này, rồi đăng nhập lại.</p>
        <button type="button" className="button" onClick={props.onSignOut}><LogOut className="ico" size={16} aria-hidden="true" /> Đăng xuất</button>
      </section>
    </main>
  );
}
