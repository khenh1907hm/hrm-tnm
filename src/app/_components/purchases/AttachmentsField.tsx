"use client";
import { useEffect, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import type { Notify } from "../Toast";
import { ATTACHMENT_KINDS, formatSize, listAttachments, openAttachment, removeAttachment, uploadAttachment, type AttachmentKind, type PurchaseAttachment } from "./purchaseFiles";

export type PendingFile = { key: string; kind: AttachmentKind; file: File };

/**
 * 4 mục tệp đính kèm của đơn hàng. Dùng ở hai chỗ:
 *  - Soạn đơn (chưa có id đơn): giữ tệp chờ (pending), lưu đơn xong mới tải lên.
 *  - Chi tiết đơn: tải lên / xóa ngay.
 */
export function AttachmentsField(props: {
  existing: readonly PurchaseAttachment[]; pending?: readonly PendingFile[]; onPendingChange?: (next: PendingFile[]) => void;
  orderId?: string; editable: boolean; requireSigned: boolean; onChanged?: () => void; setNotice: Notify;
}) {
  const [busy, setBusy] = useState<AttachmentKind | null>(null);
  const add = async (kind: AttachmentKind, list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (props.orderId && !props.onPendingChange) {
      setBusy(kind);
      try { for (const file of files) await uploadAttachment(props.orderId, kind, file); props.setNotice(`Đã tải ${files.length} tệp lên.`, "success"); props.onChanged?.(); }
      catch (error) { props.setNotice(error instanceof Error ? error.message : "Không tải được tệp.", "error"); }
      finally { setBusy(null); }
      return;
    }
    props.onPendingChange?.([...(props.pending ?? []), ...files.map((file) => ({ key: `${kind}-${file.name}-${file.size}-${Math.random()}`, kind, file }))]);
  };
  const drop = async (item: PurchaseAttachment) => {
    if (!window.confirm(`Xóa tệp ${item.fileName}?`)) return;
    try { await removeAttachment(item); props.onChanged?.(); } catch (error) { props.setNotice(error instanceof Error ? error.message : "Không xóa được tệp.", "error"); }
  };
  return (
    <div className="po-files">
      {ATTACHMENT_KINDS.map(({ kind, label, required }) => {
        const saved = props.existing.filter((item) => item.kind === kind);
        const waiting = (props.pending ?? []).filter((item) => item.kind === kind);
        const missing = required && props.requireSigned && !saved.length && !waiting.length;
        return (
          <div key={kind} className={`po-file-row${missing ? " missing" : ""}`}>
            <div className="po-file-label"><Paperclip size={14} aria-hidden="true" /> <b>{label}</b>{required && props.requireSigned && <span className="po-req">bắt buộc</span>}</div>
            <ul className="po-file-list">
              {saved.map((item) => (
                <li key={item.id}>
                  <button type="button" className="link-button" onClick={() => void openAttachment(item).catch((error: unknown) => props.setNotice(error instanceof Error ? error.message : "Không mở được tệp.", "error"))}>{item.fileName}</button>
                  <small className="muted"> {formatSize(item.sizeBytes)}</small>
                  {props.editable && <button type="button" className="icon-link" aria-label={`Xóa ${item.fileName}`} onClick={() => void drop(item)}><Trash2 size={13} aria-hidden="true" /></button>}
                </li>
              ))}
              {waiting.map((item) => (
                <li key={item.key}>
                  <span>{item.file.name}</span> <small className="muted">{formatSize(item.file.size)} · chờ lưu</small>
                  <button type="button" className="icon-link" aria-label={`Bỏ ${item.file.name}`} onClick={() => props.onPendingChange?.((props.pending ?? []).filter((other) => other.key !== item.key))}><Trash2 size={13} aria-hidden="true" /></button>
                </li>
              ))}
              {!saved.length && !waiting.length && <li><small className={missing ? "warn-text" : "muted"}>{missing ? "Chưa có tệp (cần trước khi gửi duyệt)" : "Chưa có tệp"}</small></li>}
            </ul>
            {props.editable && (
              <label className="button po-file-add">
                <Upload size={14} aria-hidden="true" /> {busy === kind ? "Đang tải…" : "Chọn tệp"}
                <input type="file" multiple hidden disabled={busy !== null} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.dwg,.dxf,.zip" onChange={(event) => { void add(kind, event.target.files); event.target.value = ""; }} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Mục tệp đính kèm trong chi tiết đơn: tải danh sách, thêm, xóa. */
export function OrderAttachments(props: { orderId: string; editable: boolean; requireSigned: boolean; setNotice: Notify }) {
  const [items, setItems] = useState<PurchaseAttachment[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void listAttachments(props.orderId).then((list) => { if (active) setItems(list); }, () => { if (active) setItems([]); });
    return () => { active = false; };
  }, [props.orderId, attempt]);
  return (
    <section className="panel pj-section" aria-labelledby="po-files-title">
      <h2 id="po-files-title"><Paperclip className="ico" size={18} aria-hidden="true" /> Tệp đính kèm</h2>
      {!items ? <div className="loading">Đang tải tệp…</div>
        : <AttachmentsField existing={items} orderId={props.orderId} editable={props.editable} requireSigned={props.requireSigned} onChanged={() => setAttempt((value) => value + 1)} setNotice={props.setNotice} />}
    </section>
  );
}
