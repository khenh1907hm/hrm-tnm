"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { MIN_PASSWORD_LENGTH } from "../../lib/accountAdmin";
import { changeOwnPassword } from "../../lib/passwordChange";
import { getSupabaseClient } from "../../lib/supabase/client";

/** Người đang đăng nhập tự đổi mật khẩu: nhập mật khẩu hiện tại để xác nhận. */
export function ChangePasswordModal(props: { email: string; onClose: () => void }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const client = getSupabaseClient();
    if (!client) { setError("Bản demo không có tài khoản thật."); return; }
    setBusy(true); setError(null);
    try {
      const failure = await changeOwnPassword(client.auth, props.email, form);
      if (failure) setError(failure); else setDone(true);
    } catch { setError("Không kết nối được máy chủ."); }
    finally { setBusy(false); }
  };

  // Mở từ thanh bên (position: sticky tạo lớp xếp chồng riêng): đưa ra body để không bị trang chính đè lên
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card accounts-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <header>
          <h2 id="change-password-title">Đổi mật khẩu</h2>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        {done ? <div className="accounts-modal-body"><p className="ok-text" role="status">Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.</p></div> : <form className="accounts-modal-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <input type="email" name="username" autoComplete="username" value={props.email} readOnly hidden />
          <label className="field"><span>Mật khẩu hiện tại</span><input type="password" autoComplete="current-password" value={form.current} onChange={(event) => setForm({ ...form, current: event.target.value })} /></label>
          <label className="field"><span>Mật khẩu mới <small>(tối thiểu {MIN_PASSWORD_LENGTH} ký tự)</small></span><input type="password" autoComplete="new-password" value={form.next} onChange={(event) => setForm({ ...form, next: event.target.value })} /></label>
          <label className="field"><span>Nhập lại mật khẩu mới</span><input type="password" autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" hidden />
        </form>}
        <footer>
          {done
            ? <button type="button" className="button primary" onClick={props.onClose}>Đóng</button>
            : <><button type="button" className="button" onClick={props.onClose}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</button></>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
