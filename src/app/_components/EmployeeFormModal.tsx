import { useRef, useState, type FormEvent } from "react";
import type { Actor } from "../../modules/auth/permissions";
import { employeeInputSchema } from "../../modules/employees/schema";
import type { Employee, EmployeeInput } from "../../modules/employees/types";
import { applyOcrToForm, type OcrFormField, type OcrRejectedValue } from "../../modules/ocr/applyOcrToForm";
import { checkIdImages } from "../../modules/ocr/imageFiles";
import { mergeParsed, parseIdText } from "../../modules/ocr/parseIdText";
import { readIdImages, type OcrProgress } from "../../modules/ocr/readIdImages";
import { Field } from "./Field";
import { issueText, ocrFieldLabel, type App, type SetNotice } from "./shared";

const CHATGPT_PHOTO_PROMPT = `Please crop and format this photo into a standard professional 3:4 passport/ID portrait (aspect ratio 3:4, width 300px, height 400px). Crucial requirements: Keep the person's exact face, facial features, skin texture, expression, and eye details 100% authentic and natural — do NOT beautify, alter, smooth out, or regenerate any facial features. Center the head and upper shoulders against a clean, plain solid white background with soft, even studio lighting. The head should occupy approximately 70% to 80% of the vertical frame.`;
const EDIT_TOUCHED_FIELDS: OcrFormField[] = ["name", "dob", "cccd", "phone", "home", "address", "currentAddress"];

/** `editing` là hồ sơ đang sửa; null khi thêm mới. */
export function EmployeeFormModal(props: { app: App; actor: Actor; editing: Employee | null; initial: EmployeeInput; onClose: () => void; onSaved: (employee: Employee) => void; setNotice: SetNotice }) {
  const { app, actor, editing, setNotice } = props;
  const [form, setForm] = useState<EmployeeInput>(props.initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idImages, setIdImages] = useState<File[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrFilledFields, setOcrFilledFields] = useState<Set<OcrFormField>>(new Set());
  const [touchedFields, setTouchedFields] = useState<Set<OcrFormField>>(() => new Set(editing ? EDIT_TOUCHED_FIELDS : []));
  const [ocrRejected, setOcrRejected] = useState<OcrRejectedValue[]>([]);
  const [ocrMissing, setOcrMissing] = useState<OcrFormField[]>([]);
  const ocrAbort = useRef<AbortController | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoSelect = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setNotice("Chỉ nhận ảnh chân dung JPG, PNG hoặc WebP.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result;
      if (typeof dataUrl === "string") {
        setForm((cur) => ({ ...cur, photo: dataUrl }));
      }
    };
    reader.readAsDataURL(file);
  };

  const copyPhotoPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_PHOTO_PROMPT);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2500);
    } catch {
      setNotice("Không thể sao chép tự động, vui lòng chọn văn bản và bấm Ctrl+C.");
    }
  };

  const saveEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = employeeInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((item) => [String(item.path[0] ?? "form"), "Vui lòng kiểm tra thông tin trường này."])));
      return;
    }
    const preview = await app.employees.validate(actor, { ...form, ...(editing ? { excludeId: editing.id } : {}) });
    if (!preview.ok) {
      setErrors(Object.fromEntries(preview.errors.map((item) => [item.field ?? "form", issueText(item.code)])));
      return;
    }
    if (preview.warnings.length && !window.confirm(preview.warnings.map((item) => issueText(item.code)).join("\n"))) return;
    const result = editing
      ? await app.employees.update(actor, { ...form, id: editing.id, expectedVersion: editing.version })
      : await app.employees.create(actor, form);
    if (!result.ok) {
      setErrors(Object.fromEntries(result.errors.map((item) => [item.field ?? "form", issueText(item.code)])));
      return;
    }
    props.onSaved(result.value);
  };

  const selectIdImages = (files: readonly File[]) => {
    const metadata = files.map((file) => ({ name: file.name, type: file.type, size: file.size }));
    const checked = checkIdImages(metadata, Math.max(0, 4 - idImages.length));
    const validFiles = new Set(checked.valid);
    const accepted = files.filter((_, index) => metadata[index] !== undefined && validFiles.has(metadata[index]));
    setIdImages((current) => [...current, ...accepted].slice(0, 4));
    if (checked.rejected.length) setNotice(checked.rejected.map((item) => item.reason === "type" ? `Đã bỏ qua ${item.file.name}: chỉ nhận ảnh JPG, PNG hoặc WebP.` : `Đã bỏ qua ${item.file.name}: ảnh vượt quá giới hạn 10 MB hoặc quá số lượng tối đa.`).join(" "));
  };

  const markOcrFieldTouched = (field: OcrFormField) => {
    setTouchedFields((current) => new Set([...current, field]));
    setOcrFilledFields((current) => { const next = new Set(current); next.delete(field); return next; });
  };

  const readIdentityImages = async () => {
    if (!idImages.length || ocrBusy) return;
    setOcrBusy(true); setOcrProgress(null); setOcrRejected([]);
    const controller = new AbortController(); ocrAbort.current = controller;
    try {
      const languageChecks = await Promise.all(["vie", "eng"].map(async (language) => {
        const r = await fetch(`/tessdata/${language}.traineddata`, { method: "HEAD", cache: "no-store" });
        return { language, ok: r.ok };
      }));
      const missingLang = languageChecks.find((item) => !item.ok);
      if (missingLang) { setNotice(`Thiếu public/tessdata/${missingLang.language}.traineddata — xem README mục Đọc ảnh để tải về.`); return; }
      const result = await readIdImages(idImages, controller.signal, setOcrProgress);
      if (result.cancelled) { setNotice("Đã hủy thao tác đọc ảnh. Bạn vẫn có thể tiếp tục nhập tay."); return; }
      const parsed = result.texts.map((text) => parseIdText(text));
      const merged = mergeParsed(parsed);
      const applied = applyOcrToForm(form, { parsed: merged }, touchedFields);
      let accepted = applied;
      if (applied.skippedBecauseTyped.length && window.confirm("Một số trường đã được bạn nhập. Bạn có muốn ghi đè các trường này bằng kết quả đọc ảnh không?")) {
        const overwriteFields = new Set([...touchedFields].filter((field) => !applied.skippedBecauseTyped.includes(field)));
        accepted = applyOcrToForm(form, { parsed: merged }, overwriteFields);
        setTouchedFields(overwriteFields);
      }
      setForm(accepted.nextForm); setOcrFilledFields((current) => new Set([...current, ...accepted.filled]));
      setOcrRejected(accepted.rejected); setOcrMissing(accepted.missing);
      setIdImages([]);
      setNotice("Đã đọc xong ảnh. Vui lòng kiểm tra các trường được tự điền trước khi lưu hồ sơ.");
    } catch {
      setNotice(controller.signal.aborted ? "Đã hủy thao tác đọc ảnh. Bạn vẫn có thể tiếp tục nhập tay." : "Không đọc được ảnh. Bạn có thể thử lại hoặc tiếp tục nhập thông tin bằng tay.");
    } finally {
      ocrAbort.current = null; setOcrBusy(false); setOcrProgress(null); setIdImages([]);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card" onSubmit={(event) => void saveEmployee(event)}>
        <header>
          <h2>{editing ? "Sửa hồ sơ nhân sự" : "Thêm nhân sự"}</h2>
          <button type="button" className="close" onClick={props.onClose}>×</button>
        </header>

        {/* Khung ảnh thẻ 3x4 & Prompt ChatGPT trên cùng */}
        <div className="photo-uploader-top">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              handlePhotoSelect(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {form.photo ? (
            <div className="photo-preview-3x4">
              <img src={form.photo} alt="Ảnh thẻ 3x4" />
              <button
                type="button"
                className="photo-remove-btn"
                title="Xóa ảnh"
                onClick={() => setForm({ ...form, photo: null })}
              >
                ×
              </button>
            </div>
          ) : (
            <div
              className="photo-skeleton"
              title="Bấm để tải ảnh chân dung 3×4"
              onClick={() => photoInputRef.current?.click()}
            >
              <span style={{ fontSize: "28px" }}>👤</span>
              <span>Ảnh thẻ 3×4</span>
              <small style={{ fontWeight: 400, fontSize: "10px", color: "var(--muted)" }}>Bấm tải ảnh</small>
            </div>
          )}
          <div className="photo-prompt-side">
            <div className="prompt-header">
              <span className="prompt-title">
                <span>🤖</span> Prompt ChatGPT tạo ảnh 3×4 chuẩn nét mặt:
              </span>
              <button
                type="button"
                className={promptCopied ? "prompt-copy-btn copied" : "prompt-copy-btn"}
                onClick={() => void copyPhotoPrompt()}
              >
                {promptCopied ? "✓ Đã sao chép" : "📋 Sao chép prompt"}
              </button>
            </div>
            <div className="prompt-text-box" onClick={() => void copyPhotoPrompt()} title="Bấm để sao chép">
              {CHATGPT_PHOTO_PROMPT}
            </div>
            <p className="prompt-hint">
              💡 Gửi ảnh chụp của nhân viên cùng câu prompt này vào ChatGPT để AI cắt đúng khung 3×4 và giữ nguyên 100% ngũ quan.
            </p>
          </div>
        </div>

        {/* Quét CCCD tự động nổi bật & ngắn gọn */}
        <section className="ocr-reader-compact">
          <div className="ocr-header-row">
            <div className="ocr-badge">
              <span className="ocr-icon">🪪</span>
              <div>
                <b>Quét CCCD tự động (AI OCR)</b>
                <p>Tự động điền họ tên, ngày sinh, CCCD, địa chỉ từ ảnh 2 mặt</p>
              </div>
            </div>
            {idImages.length > 0 && (
              <div className="ocr-action-btn-group">
                <span className="ocr-image-count">Đã chọn {idImages.length} ảnh</span>
                <button
                  type="button"
                  className="button ocr-scan-btn"
                  disabled={ocrBusy}
                  onClick={() => void readIdentityImages()}
                >
                  {ocrBusy ? "Đang quét…" : ocrFilledFields.size ? "Quét lại" : "⚡ Quét & Điền dữ liệu"}
                </button>
              </div>
            )}
          </div>
          <label
            className="ocr-dropzone-compact"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              selectIdImages(Array.from(event.dataTransfer.files));
            }}
          >
            <span>📁 Kéo thả hoặc bấm để chọn ảnh CCCD (1–4 ảnh JPG, PNG, WebP)</span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                selectIdImages(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </label>
          {ocrBusy && (
            <div className="ocr-progress">
              <progress max={1} value={ocrProgress?.progress ?? 0} />
              <span>{ocrProgress ? `${ocrProgress.status} · Ảnh ${ocrProgress.index + 1}/${ocrProgress.total}` : "Đang khởi động bộ đọc ảnh…"}</span>
              <button type="button" className="button" onClick={() => ocrAbort.current?.abort()}>Hủy</button>
            </div>
          )}
          {ocrRejected.length > 0 && (
            <div className="ocr-results">
              <b>Chưa khớp dữ liệu:</b> {ocrRejected.map((item, index) => <span key={index} style={{ marginRight: "10px" }}>{item.field}: {item.raw}</span>)}
            </div>
          )}
          {ocrMissing.length > 0 && (
            <div className="ocr-results">
              <b>Chưa tìm thấy:</b> {ocrMissing.map(ocrFieldLabel).join(", ")} (có thể nhập tay)
            </div>
          )}
        </section>

        <div className="form-grid">
          <Field label="Mã nhân viên" name="code" value={form.code} error={errors.code} onChange={(value) => setForm({ ...form, code: value })} />
          <Field label="Họ và tên" name="name" value={form.name} error={errors.name} fromOcr={ocrFilledFields.has("name")} onChange={(value) => { setForm({ ...form, name: value }); markOcrFieldTouched("name"); }} />
          <Field label="Ngày sinh" name="dob" type="date" value={form.dob} error={errors.dob} fromOcr={ocrFilledFields.has("dob")} onChange={(value) => { setForm({ ...form, dob: value }); markOcrFieldTouched("dob"); }} />
          <label className={ocrFilledFields.has("gender") ? "field ocr-filled" : "field"}>
            <span>Giới tính</span>
            {ocrFilledFields.has("gender") && <small>Tự điền từ ảnh, hãy kiểm tra</small>}
            <select value={form.gender} onChange={(event) => { setForm({ ...form, gender: event.target.value === "Nữ" ? "Nữ" : "Nam" }); markOcrFieldTouched("gender"); }}>
              <option>Nam</option>
              <option>Nữ</option>
            </select>
            {errors.gender && <small>{errors.gender}</small>}
          </label>
          <Field label="Số căn cước công dân" name="cccd" value={form.cccd} error={errors.cccd} fromOcr={ocrFilledFields.has("cccd")} onChange={(value) => { setForm({ ...form, cccd: value }); markOcrFieldTouched("cccd"); }} />
          <Field label="Điện thoại" name="phone" value={form.phone} error={errors.phone} fromOcr={ocrFilledFields.has("phone")} onChange={(value) => { setForm({ ...form, phone: value }); markOcrFieldTouched("phone"); }} />

          {/* Chỉ hiện trường lý do khi thực sự có cảnh báo không khớp hoặc đã có lý do */}
          {Boolean(form.mismatchOverrideReason || errors.cccd) && (
            <div style={{ gridColumn: "1 / -1", background: "#fffbeb", padding: "10px 14px", borderRadius: "8px", border: "1px solid #fde68a", marginBottom: "12px" }}>
              <Field
                label="Lý do xác nhận CCCD không khớp (do công an cấp nhầm / khác giấy tờ)"
                name="mismatchOverrideReason"
                value={form.mismatchOverrideReason ?? ""}
                error={errors.cccd}
                onChange={(value) => setForm({ ...form, mismatchOverrideReason: value })}
              />
              <small style={{ color: "#92400e" }}>Chỉ điền khi số CCCD thực sự không khớp với năm sinh hoặc giới tính do lỗi cấp phát.</small>
            </div>
          )}

          <Field label="Nguyên quán" name="home" value={form.home} error={errors.home} fromOcr={ocrFilledFields.has("home")} onChange={(value) => { setForm({ ...form, home: value }); markOcrFieldTouched("home"); }} />
          <Field label="Địa chỉ thường trú" name="address" value={form.address} error={errors.address} fromOcr={ocrFilledFields.has("address")} onChange={(value) => { setForm({ ...form, address: value }); markOcrFieldTouched("address"); }} />
          <Field label="Địa chỉ hiện tại" name="currentAddress" value={form.currentAddress ?? ""} error={errors.currentAddress} fromOcr={ocrFilledFields.has("currentAddress")} onChange={(value) => { setForm({ ...form, currentAddress: value }); markOcrFieldTouched("currentAddress"); }} />
          <label className="field">
            <span>Chức danh</span>
            <select value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value === "Giám đốc" ? "Giám đốc" : event.target.value === "Nhân sự" ? "Nhân sự" : event.target.value === "Trưởng phòng kỹ thuật" ? "Trưởng phòng kỹ thuật" : event.target.value === "Nhân viên kỹ thuật" ? "Nhân viên kỹ thuật" : "Nhân viên hiện trường" })}>
              <option>Giám đốc</option>
              <option>Nhân sự</option>
              <option>Trưởng phòng kỹ thuật</option>
              <option>Nhân viên kỹ thuật</option>
              <option>Nhân viên hiện trường</option>
            </select>
            {errors.position && <small>{errors.position}</small>}
          </label>
          <Field label="Ngày nhận việc" name="startDate" type="date" value={form.startDate} error={errors.startDate} onChange={(value) => setForm({ ...form, startDate: value })} />
          {errors.form && <p className="form-error">{errors.form}</p>}
        </div>
        <footer>
          <button className="button" type="button" onClick={() => { ocrAbort.current?.abort(); setIdImages([]); props.onClose(); }}>Hủy</button>
          <button className="button primary" type="submit">Lưu hồ sơ</button>
        </footer>
      </form>
    </div>
  );
}
