"use client";
import { useEffect, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import type { Notify } from "../Toast";
import { ATTACHMENT_KINDS, formatSize, purchaseFiles, type Attachment, type AttachmentApi, type AttachmentKindInfo } from "./purchaseFiles";

export type PendingFile = { key: string; kind: string; file: File };

/**
 * Các mục tệp đính kèm của một phiếu. Dùng ở hai kiểu:
 *  - Soạn phiếu chưa có id: giữ tệp chờ (pending), lưu phiếu xong mới tải lên.
 *  - Phiếu đã có (parentId): tải lên / xóa ngay.
 */
export function AttachmentsField(props: {
  existing: readonly Attachment[]; pending?: readonly PendingFile[]; onPendingChange?: (next: PendingFile[]) => void;
  parentId?: string; api?: AttachmentApi; kinds?: readonly AttachmentKindInfo[];
  editable: boolean; requireSigned: boolean; onChanged?: () => void; setNotice: Notify;
}) {
  const api = props.api ?? purchaseFiles;
  const kinds = props.kinds ?? ATTACHMENT_KINDS;
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (kind: string, list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (props.parentId && !props.onPendingChange) {
      setBusy(kind);
      try { for (const file of files) await api.upload(props.parentId, kind, file); props.setNotice(`Đã tải ${files.length} tệp lên.`, "success"); props.onChanged?.(); }
      catch (error) { props.setNotice(error instanceof Error ? error.message : "Không tải được tệp.", "error"); }
      finally { setBusy(null); }
      return;
    }
    props.onPendingChange?.([...(props.pending ?? []), ...files.map((file) => ({ key: `${kind}-${file.name}-${file.size}-${Math.random()}`, kind, file }))]);
  };
  const drop = async (item: Attachment) => {
    if (!window.confirm(`Xóa tệp ${item.fileName}?`)) return;
    try { await api.remove(item); props.onChanged?.(); } catch (error) { props.setNotice(error instanceof Error ? error.message : "Không xóa được tệp.", "error"); }
  };
  return (
    <div className="po-files">
      {kinds.map(({ kind, label, required }) => {
        const saved = props.existing.filter((item) => item.kind === kind);
        const waiting = (props.pending ?? []).filter((item) => item.kind === kind);
        const missing = required && props.requireSigned && !saved.length && !waiting.length;
        return (
          <div key={kind} className={`po-file-row${missing ? " missing" : ""}`}>
            <div className="po-file-label"><Paperclip size={14} aria-hidden="true" /> <b>{label}</b>{required && props.requireSigned && <span className="po-req">bắt buộc</span>}</div>
            <ul className="po-file-list">
              {saved.map((item) => (
                <li key={item.id}>
                  <button type="button" className="link-button" onClick={() => void api.open(item).catch((error: unknown) => props.setNotice(error instanceof Error ? error.message : "Không mở được tệp.", "error"))}>{item.fileName}</button>
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
                <input type="file" multiple hidden disabled={busy !== null} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.dwg,.dxf,.zip,.msg,.eml" onChange={(event) => { void add(kind, event.target.files); event.target.value = ""; }} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Mục tệp đính kèm của một phiếu đã có: tải danh sách, thêm, xóa. */
export function SavedAttachments(props: { parentId: string; api: AttachmentApi; kinds: readonly AttachmentKindInfo[]; editable: boolean; requireSigned: boolean; setNotice: Notify; onChanged?: (items: Attachment[], parentId: string) => void }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { parentId, api, onChanged } = props;
  useEffect(() => {
    let active = true;
    void api.list(parentId).then((list) => { if (active) { setItems(list); onChanged?.(list, parentId); } }, () => { if (active) setItems([]); });
    return () => { active = false; };
  }, [parentId, api, attempt, onChanged]);
  if (!items) return <div className="loading">Đang tải tệp…</div>;
  return <AttachmentsField existing={items} parentId={parentId} api={api} kinds={props.kinds} editable={props.editable} requireSigned={props.requireSigned} onChanged={() => setAttempt((value) => value + 1)} setNotice={props.setNotice} />;
}

/** Mục tệp đính kèm trong chi tiết đơn hàng. */
export function OrderAttachments(props: { orderId: string; editable: boolean; requireSigned: boolean; setNotice: Notify }) {
  return (
    <section className="panel pj-section" aria-labelledby="po-files-title">
      <h2 id="po-files-title"><Paperclip className="ico" size={18} aria-hidden="true" /> Attach file</h2>
      <SavedAttachments parentId={props.orderId} api={purchaseFiles} kinds={ATTACHMENT_KINDS} editable={props.editable} requireSigned={props.requireSigned} setNotice={props.setNotice} />
    </section>
  );
}
