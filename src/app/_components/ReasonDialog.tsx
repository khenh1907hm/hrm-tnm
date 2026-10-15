import { useEffect, useRef, useState } from "react";
import { Archive, X } from "lucide-react";

/** Hộp xác nhận thao tác cần lý do (lưu trữ hồ sơ, ẩn chứng chỉ…), thay cho window.prompt. */
export function ReasonDialog(props: {
  title: string;
  description: string;
  confirmLabel: string;
  minLength?: number;
  /** Trả về thông báo lỗi để hiện trong hộp, hoặc null khi thành công. */
  onConfirm: (reason: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const minLength = props.minLength ?? 3;
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (reason.trim().length < minLength) { setError(`Nhập lý do, tối thiểu ${minLength} ký tự.`); return; }
    setBusy(true);
    const problem = await props.onConfirm(reason.trim());
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") props.onClose(); }}>
      <section className="modal-card reason-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reason-title" aria-describedby="reason-desc">
        <header>
          <h2 id="reason-title"><Archive className="ico" size={18} aria-hidden="true" /> {props.title}</h2>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="reason-body">
          <p id="reason-desc">{props.description}</p>
          <label className="field">
            <span>Lý do *</span>
            <textarea ref={inputRef} rows={3} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(); }} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" className="button" onClick={props.onClose}>Hủy</button>
          <button type="button" className="button danger-solid" disabled={busy} onClick={() => void submit()}>{busy ? "Đang xử lý…" : props.confirmLabel}</button>
        </footer>
      </section>
    </div>
  );
}
