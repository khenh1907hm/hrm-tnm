import { useEffect, useMemo, useState } from "react";
import { PenLine, Plus, Star, Trash2, X } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import type { Signature } from "../../modules/signatures/types";
import { SignatureFormModal } from "./SignatureFormModal";
import { issueText, type App, type SetNotice, type SignatureRow } from "./shared";

/** Thư viện chữ ký: xem ảnh, thêm, sửa, đặt mặc định, xóa. */
export function SignaturesView(props: {
  app: App; actor: Actor; signatureRows: SignatureRow[]; onSignatureRowsChange: (rows: SignatureRow[]) => void;
  sessionFiles: Readonly<Record<string, File>>; ensureFiles: (refs: { id: string; name: string }[]) => Promise<unknown>;
  onFilesAdded: (files: Record<string, File>) => void; setNotice: SetNotice;
}) {
  const { app, actor, signatureRows, sessionFiles } = props;
  const isAdmin = actor.role === "admin";
  const [form, setForm] = useState<{ editing: Signature | null } | null>(null);
  const [removing, setRemoving] = useState<Signature | null>(null);
  const [busy, setBusy] = useState(false);

  // Tải ảnh chữ ký về để xem (chế độ thật)
  const refs = useMemo(() => signatureRows.map((row) => ({ id: row.file.id, name: row.file.name })), [signatureRows]);
  useEffect(() => { if (refs.length) void props.ensureFiles(refs); }, [refs]); // eslint-disable-line react-hooks/exhaustive-deps
  const urls = useMemo(() => Object.fromEntries(signatureRows.flatMap((row) => sessionFiles[row.file.id] ? [[row.id, URL.createObjectURL(sessionFiles[row.file.id]!)]] : [])), [signatureRows, sessionFiles]);
  useEffect(() => () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url)), [urls]);

  const reload = async () => { const updated = await app.signatures.list(actor); if (updated.ok) props.onSignatureRowsChange(updated.value); };
  const setDefault = async (signature: Signature) => {
    const result = await app.signatures.setDefault(actor, signature.id);
    props.setNotice(result.ok ? `Đã đặt ${signature.name} làm chữ ký mặc định.` : issueText(result.errors[0]?.code ?? "SIGNATURE_NOT_FOUND"), result.ok ? "success" : "error");
    await reload();
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const result = await app.signatures.remove(actor, removing.id);
    setBusy(false);
    props.setNotice(result.ok ? `Đã xóa chữ ký ${removing.name}.` : issueText(result.errors[0]?.code ?? "SIGNATURE_NOT_FOUND"), result.ok ? "success" : "error");
    setRemoving(null);
    await reload();
  };

  return <>
    <div className="page-head">
      <div><h1>Thư viện chữ ký</h1><p>Người ký phiếu thông tin và hồ sơ xuất cho khách hàng</p></div>
      {isAdmin && <button className="button primary" onClick={() => setForm({ editing: null })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm chữ ký</button>}
    </div>
    <div className="signature-grid">
      {signatureRows.map((signature) => (
        <article className={`panel signature-card${signature.isDefault ? " is-default" : ""}`} key={signature.id}>
          <div className="checkerboard signature-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {urls[signature.id] ? <img src={urls[signature.id]} alt={`Chữ ký của ${signature.name}`} /> : <span className="muted">Đang tải ảnh…</span>}
          </div>
          <div className="signature-meta">
            <div><b>{signature.name}</b><span>{signature.role}</span></div>
            {signature.isDefault && <span className="pill ok"><Star size={12} aria-hidden="true" /> Mặc định</span>}
          </div>
          {isAdmin && (
            <div className="signature-actions">
              {!signature.isDefault && <button type="button" className="button" onClick={() => void setDefault(signature)}><Star className="ico" size={14} aria-hidden="true" /> Đặt mặc định</button>}
              <button type="button" className="button" onClick={() => setForm({ editing: signature })}><PenLine className="ico" size={14} aria-hidden="true" /> Sửa</button>
              <button type="button" className="button danger" disabled={signatureRows.length <= 1} title={signatureRows.length <= 1 ? "Cần giữ ít nhất một chữ ký" : undefined} onClick={() => setRemoving(signature)}><Trash2 className="ico" size={14} aria-hidden="true" /> Xóa</button>
            </div>
          )}
        </article>
      ))}
      {!signatureRows.length && (
        <div className="panel empty signature-empty">
          <PenLine size={28} aria-hidden="true" />
          <p>Chưa có chữ ký mẫu. Thêm chữ ký để dùng khi xuất phiếu thông tin.</p>
          {isAdmin && <button className="button primary" onClick={() => setForm({ editing: null })}><Plus className="ico" size={16} aria-hidden="true" /> Thêm chữ ký đầu tiên</button>}
        </div>
      )}
    </div>

    {form && <SignatureFormModal app={app} actor={actor} editing={form.editing} currentImageUrl={form.editing ? urls[form.editing.id] : undefined} setNotice={props.setNotice}
      onClose={() => setForm(null)}
      onSaved={(signature, file) => {
        if (file) props.onFilesAdded({ [signature.file.id]: file });
        props.setNotice(form.editing ? "Đã lưu thay đổi chữ ký." : "Đã thêm chữ ký (nền trắng đã được tách).", "success");
        setForm(null);
        void reload();
      }} />}

    {removing && (
      <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") setRemoving(null); }}>
        <section className="modal-card reason-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-signature-title">
          <header><h2 id="remove-signature-title"><Trash2 className="ico" size={18} aria-hidden="true" /> Xóa chữ ký</h2><button type="button" className="close" aria-label="Đóng" onClick={() => setRemoving(null)}><X size={20} aria-hidden="true" /></button></header>
          <div className="reason-body"><p>Xóa chữ ký của <b>{removing.name}</b> ({removing.role})? {removing.isDefault ? "Chữ ký mặc định sẽ chuyển sang chữ ký khác." : ""} Phiếu đã xuất trước đây không bị ảnh hưởng.</p></div>
          <footer><button type="button" className="button" onClick={() => setRemoving(null)}>Hủy</button><button type="button" className="button danger-solid" disabled={busy} autoFocus onClick={() => void remove()}>{busy ? "Đang xóa…" : "Xóa chữ ký"}</button></footer>
        </section>
      </div>
    )}
  </>;
}
