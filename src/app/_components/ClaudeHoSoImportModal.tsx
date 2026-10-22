import { useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import { formatDate } from "../../lib/dates";
import { parseHoSoFile, type HoSoFile, type HoSoOverrides } from "../../modules/claude-ho-so/hoSo";
import { callHoSo, type HoSoPreview } from "./claudeHoSoApi";
import { issueText, type SetNotice } from "./shared";

/**
 * Nhập hồ sơ từ Claude: chọn các file do skill /ho-so xuất ra, xem trước từng người (mã dự kiến hoặc
 * điểm khác với hồ sơ đã có cùng CCCD), bổ sung số điện thoại nếu thiếu, rồi lưu.
 * Việc ghi do Edge Function `ho-so` làm, nên dùng được cho cả tài khoản HR (HOSO-01…04).
 */

type ItemStatus = "checking" | "ready" | "saving" | "saved" | "failed";
type Item = {
  /** raw: nội dung gốc của file, gửi nguyên cho máy chủ để máy chủ tự đọc và kiểm tra lại. */
  key: string; fileName: string; raw: string; file: HoSoFile | null; parseError: string | null;
  phone: string; startDate: string; replacePhoto: boolean; include: boolean;
  preview: HoSoPreview | null; requestError: string | null; status: ItemStatus; result: string | null;
};

const overridesOf = (item: Item): HoSoOverrides => ({ ...(item.phone.trim() ? { phone: item.phone } : {}), ...(item.startDate ? { startDate: item.startDate } : {}) });
const photoUrl = (file: HoSoFile) => `data:${file.photo.mime};base64,${file.photo.base64}`;
const canSave = (item: Item) => item.status === "ready" && item.preview?.ok === true && !(item.preview.kind === "existing" && !item.preview.changes?.length);

export function ClaudeHoSoImportModal(props: { setNotice: SetNotice; onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const patch = (key: string, change: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  /** Hỏi máy chủ kế hoạch cho một file (không ghi gì). */
  const check = async (item: Item) => {
    if (!item.file) return;
    patch(item.key, { status: "checking", requestError: null });
    const result = await callHoSo({ mode: "preview", file: item.raw, overrides: overridesOf(item), replacePhoto: item.replacePhoto });
    if (!("kind" in result)) { patch(item.key, { status: "failed", preview: null, requestError: result.ok ? null : result.error }); return; }
    patch(item.key, { status: "ready", preview: result, include: result.ok && !(result.kind === "existing" && !result.changes?.length) });
  };

  const pickFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const read = await Promise.all(Array.from(list).map(async (file, index): Promise<Item> => {
      const raw = /\.json$/i.test(file.name) ? await file.text() : "";
      const parsed = raw ? parseHoSoFile(raw) : null;
      const parseError = !parsed ? "Chỉ nhận file .json do skill /ho-so tạo." : parsed.ok ? null : issueText(parsed.errors[0]!.code);
      const value = parsed?.ok ? parsed.value : null;
      return {
        key: `${Date.now()}-${index}-${file.name}`, fileName: file.name, raw, file: value, parseError,
        phone: value?.employee.phone ?? "", startDate: value?.employee.startDate ?? "", replacePhoto: true, include: false,
        preview: null, requestError: null, status: parseError ? "failed" : "checking", result: null,
      };
    }));
    // Hai file cùng CCCD trong một lượt: chỉ giữ file đầu, file sau báo trùng
    const seen = new Set(items.flatMap((item) => (item.file && item.status !== "saved" ? [item.file.employee.cccd] : [])));
    const checked = read.map((item) => {
      if (!item.file) return item;
      if (seen.has(item.file.employee.cccd)) return { ...item, file: null, status: "failed" as const, parseError: "Trùng số CCCD với một file khác đã chọn trong lượt này." };
      seen.add(item.file.employee.cccd);
      return item;
    });
    setItems((current) => [...current, ...checked]);
    for (const item of checked) await check(item);
  };

  const saveAll = async () => {
    const queue = items.filter((item) => item.include && canSave(item));
    if (!queue.length) return;
    setBusy(true);
    let saved = 0;
    for (const item of queue) {
      const preview = item.preview!;
      patch(item.key, { status: "saving" });
      const common = { file: item.raw, overrides: overridesOf(item), replacePhoto: item.replacePhoto };
      const result = preview.kind === "new"
        ? await callHoSo({ mode: "create", ...common })
        : await callHoSo({ mode: "update", ...common, employeeId: preview.existing!.id, expectedVersion: preview.existing!.version });
      if ("kind" in result || !result.ok) {
        const message = "kind" in result ? "Máy chủ trả về kết quả không mong đợi." : result.error;
        patch(item.key, { status: "failed", result: message });
        continue;
      }
      saved += 1;
      const detail = result.unchanged ? "không có gì thay đổi" : preview.kind === "new" ? "đã tạo hồ sơ mới" : `đã cập nhật: ${(result.changed ?? []).join(", ")}`;
      patch(item.key, { status: "saved", include: false, result: `${result.code} – ${result.name}: ${detail}.` });
    }
    setBusy(false);
    if (saved) { props.setNotice(`Đã lưu ${saved} hồ sơ từ Claude.`, "success"); props.onSaved(); }
  };

  const ready = items.filter((item) => item.include && canSave(item)).length;
  const working = busy || items.some((item) => item.status === "checking" || item.status === "saving");
  const close = () => { if (!working) props.onClose(); };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <section className="modal-card import-dialog" role="dialog" aria-modal="true" aria-labelledby="hoso-title">
        <header><h2 id="hoso-title">Nhập hồ sơ từ Claude</h2><button type="button" className="close" onClick={close} disabled={working} aria-label="Đóng">×</button></header>
        <div className="import-body">
          <div className="import-pick">
            <label className="button primary">
              <FileUp className="ico" size={16} aria-hidden="true" /> {items.length ? "Thêm file" : "Chọn file hồ sơ (.json)"}
              <input type="file" accept=".json,application/json" multiple hidden disabled={working} onChange={(event) => { void pickFiles(event.target.files); event.target.value = ""; }} />
            </label>
            <span className="muted">Có thể chọn nhiều file cùng lúc.</span>
          </div>
          {!items.length && <p className="muted">Dùng skill <b>/ho-so</b> trên Claude: gửi ảnh CCCD (hoặc VNeID) và ảnh chụp người, Claude đọc thông tin, làm ảnh 3×4 nền trắng và xuất một file cho mỗi người. Chọn các file đó ở đây; hệ thống tự cấp mã nhân viên, báo nếu số CCCD đã có và cho xem trước trước khi lưu.</p>}

          {items.map((item) => <HoSoCard key={item.key} item={item} disabled={working} onChange={(change) => patch(item.key, change)} onRecheck={(change) => void check({ ...item, ...change })} />)}
        </div>
        <footer>
          {items.some((item) => item.status === "saved") && <span className="muted">Nhập xong nên xóa các file hồ sơ khỏi máy vì có số CCCD.</span>}
          <button type="button" className="button" onClick={close} disabled={working}>{items.some((item) => item.status === "saved") ? "Xong" : "Đóng"}</button>
          <button type="button" className="button primary" disabled={!ready || working} onClick={() => void saveAll()}>{busy ? "Đang lưu…" : `Lưu ${ready} hồ sơ`}</button>
        </footer>
      </section>
    </div>
  );
}

function HoSoCard(props: { item: Item; disabled: boolean; onChange: (change: Partial<Item>) => void; onRecheck: (change?: Partial<Item>) => void }) {
  const { item, disabled, onChange } = props;
  const preview = item.preview;
  const e = item.file?.employee;
  const locked = disabled || item.status === "saved" || item.status === "saving";
  const phoneError = preview?.errors.find((issue) => issue.field === "phone");

  return (
    <article className={`panel hoso-card${item.status === "saved" ? " is-saved" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.file ? <img className="hoso-photo" src={photoUrl(item.file)} alt={`Ảnh 3×4 của ${e?.name ?? ""}`} /> : <div className="hoso-photo hoso-photo-empty" aria-hidden="true" />}
      <div className="hoso-main">
        <div className="hoso-head">
          <b>{e?.name || item.fileName}</b>
          {item.status === "checking" && <span className="pill">Đang kiểm tra…</span>}
          {item.status === "saving" && <span className="pill">Đang lưu…</span>}
          {item.status === "saved" && <span className="pill ok">Đã lưu</span>}
          {item.status === "failed" && <span className="pill bad">Lỗi</span>}
          {item.status === "ready" && preview?.kind === "new" && <span className="pill info">Hồ sơ mới · mã dự kiến {preview.code}</span>}
          {item.status === "ready" && preview?.kind === "existing" && <span className="pill warn">CCCD đã có: {preview.existing!.code} – {preview.existing!.name}</span>}
          {preview?.existing?.archivedAt && <span className="pill bad">Hồ sơ đang ẩn</span>}
        </div>

        {item.parseError && <p className="form-error" role="alert">{item.parseError}</p>}
        {item.requestError && <p className="form-error" role="alert">{item.requestError}</p>}
        {item.result && <p className={item.status === "saved" ? "hoso-result" : "form-error"} role="status">{item.result}</p>}

        {e && (
          <dl className="hoso-facts">
            <div><dt>Số CCCD</dt><dd>{e.cccd}</dd></div>
            <div><dt>Ngày sinh</dt><dd>{e.dob ? formatDate(e.dob) : "—"} · {e.gender || "—"}</dd></div>
            <div><dt>Chức danh</dt><dd>{e.position || "—"}</dd></div>
            <div><dt>Nguyên quán</dt><dd>{e.home || "—"}</dd></div>
            <div><dt>Thường trú</dt><dd>{e.address || "—"}</dd></div>
            {e.currentAddress && <div><dt>Hiện tại</dt><dd>{e.currentAddress}</dd></div>}
          </dl>
        )}

        {item.file && item.status !== "saved" && preview && (
          <div className="hoso-inputs">
            <label className="field"><span>Điện thoại{preview.kind === "new" ? " *" : ""}</span>
              <input value={item.phone} disabled={locked} inputMode="tel" placeholder={preview.kind === "existing" ? "Để trống = giữ số cũ" : "Bắt buộc với hồ sơ mới"} onChange={(event) => onChange({ phone: event.target.value })} onBlur={() => props.onRecheck()} />
              {phoneError && <small>{phoneError.message}</small>}
            </label>
            {preview.kind === "new" && (
              <label className="field"><span>Ngày nhận việc</span>
                <input type="date" value={item.startDate || preview.input.startDate} disabled={locked} onChange={(event) => onChange({ startDate: event.target.value })} onBlur={() => props.onRecheck()} />
              </label>
            )}
            {preview.kind === "existing" && (
              <label className="check-field"><input type="checkbox" checked={item.replacePhoto} disabled={locked} onChange={(event) => { onChange({ replacePhoto: event.target.checked }); props.onRecheck({ replacePhoto: event.target.checked }); }} /> Thay ảnh 3×4 bằng ảnh mới</label>
            )}
            <button type="button" className="button ghost" disabled={locked} onClick={() => props.onRecheck()}><RefreshCw className="ico" size={14} aria-hidden="true" /> Kiểm tra lại</button>
          </div>
        )}

        {preview?.kind === "existing" && item.status !== "saved" && (
          preview.changes?.length
            ? <table className="hoso-diff"><thead><tr><th>Thay đổi</th><th>Đang lưu</th><th>Từ file</th></tr></thead>
                <tbody>{preview.changes.map((change) => <tr key={change.field}><td>{change.label}</td><td>{change.old ?? "—"}</td><td>{change.new ?? "—"}</td></tr>)}</tbody></table>
            : <p className="muted">Thông tin trong file giống hồ sơ đang lưu, không có gì để cập nhật.</p>
        )}

        {preview && preview.errors.filter((issue) => issue.field !== "phone").length > 0 && (
          <ul className="hoso-issues bad">{preview.errors.filter((issue) => issue.field !== "phone").map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
        )}
        {preview && (preview.warnings.length > 0 || (preview.notes?.length ?? 0) > 0) && item.status !== "saved" && (
          <ul className="hoso-issues">{[...preview.warnings.map((issue) => issue.message), ...(preview.notes ?? []).map((note) => `Claude ghi chú: ${note}`)].map((text) => <li key={text}>{text}</li>)}</ul>
        )}

        {canSave(item) && (
          <label className="check-field hoso-include"><input type="checkbox" checked={item.include} disabled={locked} onChange={(event) => onChange({ include: event.target.checked })} /> {preview?.kind === "existing" ? "Cập nhật hồ sơ này" : "Lưu hồ sơ này"}</label>
        )}
      </div>
    </article>
  );
}
