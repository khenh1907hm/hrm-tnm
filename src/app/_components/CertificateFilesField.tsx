import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImageIcon, Star, Trash2, Upload } from "lucide-react";
import { randomIds } from "../../lib/ids";
import type { FileRef, SupplementaryFile } from "../../modules/certificates/types";

/** Một tệp trong danh sách: đã lưu (chỉ có ref) hoặc vừa chọn (có cả `file`). */
export type CertificateFileItem = { key: string; ref: FileRef; file?: File; label: string; primary: boolean };

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_SUPPLEMENTARY = 10;

export function initialFileItems(document: FileRef | null | undefined, supplementary: readonly SupplementaryFile[] = []): CertificateFileItem[] {
  return [
    ...(document ? [{ key: document.id, ref: document, label: "", primary: true }] : []),
    ...supplementary.map((item) => ({ key: item.file.id, ref: item.file, label: item.label ?? "", primary: false })),
  ];
}

/** Đổi danh sách thành tệp chính + tệp bổ sung cho dữ liệu chứng chỉ, kèm các tệp mới cần lưu. */
export function splitFileItems(items: readonly CertificateFileItem[]) {
  const primary = items.find((item) => item.primary) ?? null;
  return {
    document: primary?.ref ?? null,
    supplementaryFiles: items.filter((item) => item !== primary).map((item) => ({ file: item.ref, label: item.label.trim() || null })),
    newBinaries: Object.fromEntries(items.filter((item) => item.file).map((item) => [item.ref.id, item.file!])),
  };
}

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function CertificateFilesField(props: { items: CertificateFileItem[]; onChange: (items: CertificateFileItem[]) => void; error?: string | undefined }) {
  const { items, onChange } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const previews = useMemo(() => Object.fromEntries(items.filter((item) => item.file && item.file.type.startsWith("image/")).map((item) => [item.key, URL.createObjectURL(item.file!)])), [items]);
  useEffect(() => () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const addFiles = (files: readonly File[]) => {
    const problems: string[] = [];
    const accepted: CertificateFileItem[] = [];
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) { problems.push(`${file.name}: chỉ nhận PDF, JPG, PNG, WebP`); continue; }
      if (file.size > MAX_SIZE) { problems.push(`${file.name}: lớn hơn 10 MB`); continue; }
      if (items.length + accepted.length >= MAX_SUPPLEMENTARY + 1) { problems.push(`${file.name}: tối đa 1 tệp chính và ${MAX_SUPPLEMENTARY} tệp bổ sung`); continue; }
      const id = randomIds().next();
      accepted.push({ key: id, ref: { id, name: file.name, mime: file.type, size: file.size }, file, label: "", primary: false });
    }
    setRejected(problems);
    if (!accepted.length) return;
    const next = [...items, ...accepted];
    if (!next.some((item) => item.primary)) next[0] = { ...next[0]!, primary: true };
    onChange(next);
  };

  const makePrimary = (key: string) => onChange(items.map((item) => ({ ...item, primary: item.key === key, label: item.key === key ? "" : item.label })));
  const remove = (key: string) => {
    const next = items.filter((item) => item.key !== key);
    if (next.length && !next.some((item) => item.primary)) next[0] = { ...next[0]!, primary: true, label: "" };
    onChange(next);
  };

  return (
    <div className="field cert-files">
      <span>Tệp đính kèm <abbr title="Bắt buộc">*</abbr></span>
      <p className="field-help cert-files-help">
        <b>Tệp chính</b> là bản scan chứng chỉ, được in trong hồ sơ gửi khách. <b>Tệp bổ sung</b> là giấy tờ kèm theo (mặt sau, quyết định cấp…). Tệp đầu tiên tự là tệp chính.
      </p>
      {items.length > 0 && (
        <ul className="cert-file-list" aria-label="Danh sách tệp đính kèm">
          {items.map((item) => {
            const isImage = item.ref.mime.startsWith("image/");
            const Icon = isImage ? ImageIcon : FileText;
            return (
              <li key={item.key} className={item.primary ? "cert-file is-primary" : "cert-file"}>
                <div className="cert-file-thumb" aria-hidden="true">{previews[item.key] ? <img src={previews[item.key]} alt="" /> : <Icon size={20} />}</div>
                <div className="cert-file-main">
                  <div className="cert-file-name"><span title={item.ref.name}>{item.ref.name}</span><small>{formatSize(item.ref.size)}{item.file ? " · mới" : " · đã lưu"}</small></div>
                  {item.primary
                    ? <span className="pill info cert-file-kind"><Star className="ico" size={12} aria-hidden="true" /> Tệp chính</span>
                    : <input className="cert-file-label" aria-label={`Mô tả tệp ${item.ref.name}`} placeholder="Mô tả, vd: Mặt sau, Quyết định cấp" maxLength={100} value={item.label} onChange={(event) => onChange(items.map((candidate) => candidate.key === item.key ? { ...candidate, label: event.target.value } : candidate))} />}
                </div>
                <div className="cert-file-actions">
                  {!item.primary && <button type="button" className="button" onClick={() => makePrimary(item.key)}>Đặt làm tệp chính</button>}
                  <button type="button" className="button danger icon-button" aria-label={`Xóa ${item.ref.name}`} onClick={() => remove(item.key)}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div
        className={dragOver ? "cert-drop dragover" : "cert-drop"}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); addFiles(Array.from(event.dataTransfer.files)); }}
      >
        <Upload size={18} aria-hidden="true" />
        <span>{items.length ? "Thêm tệp" : "Kéo thả hoặc bấm để chọn tệp"}</span>
        <small>PDF, JPG, PNG, WebP · tối đa 10 MB mỗi tệp · chọn được nhiều tệp</small>
        <input ref={inputRef} type="file" multiple accept={ACCEPTED.join(",")} hidden onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </div>
      {rejected.length > 0 && <ul className="cert-file-rejected" role="alert">{rejected.map((message) => <li key={message}>{message}</li>)}</ul>}
      {props.error && <small>{props.error}</small>}
    </div>
  );
}
