import { BriefcaseBusiness, Camera, Check, Copy, ExternalLink, IdCard, Image as ImageIcon, Lightbulb, Sparkles, Undo2, UserRound, WandSparkles } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { Actor } from "../../modules/auth/permissions";
import type { FileRef } from "../../modules/certificates/types";
import { isLegacyPhoto, MAX_PHOTO_SIZE, PHOTO_MIMES } from "../../modules/employees/photo";
import { employeeInputSchema } from "../../modules/employees/schema";
import type { Employee, EmployeeInput } from "../../modules/employees/types";
import { applyOcrToForm, type OcrFormField, type OcrRejectedValue } from "../../modules/ocr/applyOcrToForm";
import { checkIdImages } from "../../modules/ocr/imageFiles";
import { mergeParsed, parseIdText } from "../../modules/ocr/parseIdText";
import { readIdImages, type OcrProgress } from "../../modules/ocr/readIdImages";
import { BackgroundRemover } from "./BackgroundRemover";
import { dataUrlToFile, newPhotoRef, photoTo3x4WithAi, preparePhoto, usePhotoUrl } from "./employeePhoto";
import { Field } from "./Field";
import { provinceOfCccd } from "../../lib/vietnam/provinceCodes";
import { issueText, ocrFieldLabel, type App, type SetNotice } from "./shared";

const CHATGPT_PHOTO_PROMPT = `Crop and format this photo into a standard professional 3:4 ID/passport portrait.

Strict requirements:
- Aspect ratio exactly 3:4
- Output size: 600 × 800 pixels
- Keep the person's face, facial features, skin texture, expression, eye details, and hair 100% authentic and natural. Do NOT beautify, smooth, alter, or regenerate any part of the face.
- Face looking straight at the camera, head upright.
- Neutral serious expression: mouth closed, no smile, no teeth showing, relaxed face, both eyes open and looking directly at the camera.
- Head and upper shoulders only. The head should occupy 70–80% of the vertical frame.
- Clean solid pure white background (#FFFFFF), no shadows.
- Soft, even studio lighting, no harsh shadows on the face.
- Do not change hair or clothing.

Output only the final cropped portrait.`;
const CHATGPT_PHOTO_URL = `https://chatgpt.com/?q=${encodeURIComponent(CHATGPT_PHOTO_PROMPT)}`;
/** Lỗi CCCD không khớp năm sinh / giới tính: chỉ khi đó mới cần ô nhập lý do xác nhận. */
const CCCD_MISMATCH_TEXTS = [issueText("CCCD_DOB_MISMATCH"), issueText("CCCD_GENDER_MISMATCH")];
/** Dưới ô CCCD: tỉnh đăng ký khai sinh theo 3 số đầu (gợi ý), hoặc báo mã tỉnh không có (lỗi). */
function cccdProvince(cccd: string): { hint: string | null; error: string | undefined } {
  const digits = cccd.trim();
  if (!/^d{3}/.test(digits)) return { hint: null, error: undefined };
  const province = provinceOfCccd(digits);
  return province ? { hint: `Nơi đăng ký khai sinh: ${province}`, error: undefined } : { hint: null, error: `Mã tỉnh ${digits.slice(0, 3)} không có trong danh sách 63 tỉnh.` };
}
const EDIT_TOUCHED_FIELDS: OcrFormField[] =["name", "dob", "cccd", "phone", "home", "address", "currentAddress"];

/** Giá trị ban đầu của form: ảnh có thể còn là data URL kiểu cũ. */
export type EmployeeFormInitial = Omit<EmployeeInput, "photo"> & Pick<Employee, "photo">;

/**
 * `editing` là hồ sơ đang sửa; null khi thêm mới.
 * Ảnh chân dung được đưa lên kho (`uploadPhoto`) trước khi lưu bản ghi; ảnh kiểu cũ (data URL) được chuyển luôn khi lưu.
 */
export function EmployeeFormModal(props: { app: App; actor: Actor; editing: Employee | null; initial: EmployeeFormInitial; loadPhoto: (ref: FileRef) => Promise<File | null>; uploadPhoto: (files: Record<string, File>) => Promise<boolean>; onClose: () => void; onSaved: (employee: Employee) => void; setNotice: SetNotice }) {
  const { app, actor, editing, setNotice } = props;
  const [legacyPhoto] = useState(() => isLegacyPhoto(props.initial.photo) ? dataUrlToFile(props.initial.photo, "anh-3x4") : null);
  const [form, setForm] = useState<EmployeeInput>(() => ({ ...props.initial, photo: legacyPhoto ? newPhotoRef(legacyPhoto) : props.initial.photo as FileRef | null }));
  /** Ảnh vừa chọn (hoặc ảnh cũ cần chuyển), chưa có trên kho. */
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(legacyPhoto);
  /** Xem trước ảnh chưa lưu, dạng data URL chỉ nằm trong bộ nhớ (không ghi vào bản ghi). */
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(() => isLegacyPhoto(props.initial.photo) ? props.initial.photo : null);
  const storedPhotoUrl = usePhotoUrl(pendingPhoto ? null : form.photo, props.loadPhoto);
  const photoUrl = pendingPhoto ? pendingPhotoUrl : storedPhotoUrl;
  const [saving, setSaving] = useState(false);
  /** Lỗi lần lưu gần nhất kèm dữ liệu form lúc đó: trường nào đã sửa khác đi thì ẩn lỗi của trường đó. */
  const [errorState, setErrorState] = useState<{ errors: Record<string, string>; form: EmployeeInput }>(() => ({ errors: {}, form }));
  const showErrors = (next: Record<string, string>) => setErrorState({ errors: next, form });
  const errors = Object.fromEntries(Object.entries(errorState.errors).filter(([field]) => form[field as keyof EmployeeInput] === errorState.form[field as keyof EmployeeInput]));
  const cccdMismatch = errors.cccd !== undefined && CCCD_MISMATCH_TEXTS.includes(errors.cccd);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrFilledFields, setOcrFilledFields] = useState<Set<OcrFormField>>(new Set());
  const [touchedFields, setTouchedFields] = useState<Set<OcrFormField>>(() => new Set(editing ? EDIT_TOUCHED_FIELDS : []));
  const [ocrRejected, setOcrRejected] = useState<OcrRejectedValue[]>([]);
  const [ocrMissing, setOcrMissing] = useState<OcrFormField[]>([]);
  const ocrAbort = useRef<AbortController | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [photoAiBusy, setPhotoAiBusy] = useState(false);
  /** Ảnh trước khi AI chỉnh, để hoàn tác nếu kết quả không giống người thật. */
  const [photoBeforeAi, setPhotoBeforeAi] = useState<{ photo: FileRef | null; pending: File | null; pendingUrl: string | null } | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  /** Dữ liệu lúc mở form, để hỏi lại trước khi đóng mà bỏ mất phần đã nhập. */
  const [openedForm] = useState(() => JSON.stringify(form));
  const closeForm = () => {
    if (JSON.stringify(form) !== openedForm && !window.confirm("Bỏ các thông tin vừa nhập mà chưa lưu?")) return;
    ocrAbort.current?.abort();
    props.onClose();
  };
  const idImageInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoSelect = (file: File | undefined, keepUndo = false) => {
    if (!file) return;
    if (!keepUndo) setPhotoBeforeAi(null);
    if (!(PHOTO_MIMES as readonly string[]).includes(file.type)) {
      setNotice("Chỉ nhận ảnh chân dung JPG, PNG hoặc WebP.");
      return;
    }
    void preparePhoto(file).then((prepared) => {
      if (prepared.size > MAX_PHOTO_SIZE) { setNotice("Ảnh chân dung vượt quá 10 MB."); return; }
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === "string") setPendingPhotoUrl(reader.result); };
      reader.readAsDataURL(prepared);
      setPendingPhoto(prepared);
      setForm((cur) => ({ ...cur, photo: newPhotoRef(prepared) }));
    });
  };
  const removePhoto = () => { setPhotoBeforeAi(null); setPendingPhoto(null); setPendingPhotoUrl(null); setForm((cur) => ({ ...cur, photo: null })); };

  const photoTo3x4 = async () => {
    const source = pendingPhoto ?? (form.photo ? await props.loadPhoto(form.photo) : null);
    if (!source) { setNotice("Chưa tải được ảnh hiện tại, hãy thử lại."); return; }
    setPhotoAiBusy(true);
    try {
      const edited = await photoTo3x4WithAi(source);
      setPhotoBeforeAi({ photo: form.photo ?? null, pending: pendingPhoto, pendingUrl: pendingPhotoUrl });
      handlePhotoSelect(edited, true);
      setNotice("AI đã chỉnh xong ảnh 3×4. Hãy kiểm tra khuôn mặt còn giống người thật trước khi lưu.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI chỉnh ảnh đang gặp lỗi, hãy thử lại sau.");
    } finally { setPhotoAiBusy(false); }
  };
  const undoPhotoAi = () => {
    if (!photoBeforeAi) return;
    setPendingPhoto(photoBeforeAi.pending);
    setPendingPhotoUrl(photoBeforeAi.pendingUrl);
    setForm((cur) => ({ ...cur, photo: photoBeforeAi.photo }));
    setPhotoBeforeAi(null);
  };

  // Ảnh chữ ký đã tách nền (thu nhỏ còn 800px cho nhẹ vì lưu ngay trong hồ sơ) → data URL
  const handleSignatureChange = (png: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result;
      if (typeof dataUrl === "string") setForm((cur) => ({ ...cur, signatureImage: dataUrl }));
    };
    reader.readAsDataURL(png);
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
      showErrors(Object.fromEntries(parsed.error.issues.map((item) => [String(item.path[0] ?? "form"), "Vui lòng kiểm tra thông tin trường này."])));
      return;
    }
    const preview = await app.employees.validate(actor, { ...form, ...(editing ? { excludeId: editing.id } : {}) });
    if (!preview.ok) {
      showErrors(Object.fromEntries(preview.errors.map((item) => [item.field ?? "form", issueText(item.code)])));
      return;
    }
    if (preview.warnings.length && !window.confirm(preview.warnings.map((item) => issueText(item.code)).join("\n"))) return;
    setSaving(true);
    try {
      if (pendingPhoto && form.photo && !await props.uploadPhoto({ [form.photo.id]: pendingPhoto })) return;
      await saveRecord();
    } finally { setSaving(false); }
  };

  const saveRecord = async () => {
    const result = editing
      ? await app.employees.update(actor, { ...form, id: editing.id, expectedVersion: editing.version })
      : await app.employees.create(actor, form);
    if (!result.ok) {
      showErrors(Object.fromEntries(result.errors.map((item) => [item.field ?? "form", issueText(item.code)])));
      return;
    }
    props.onSaved(result.value);
  };

  /** Lọc ảnh hợp lệ (tối đa 4) rồi đọc ngay. */
  const importIdImages = (files: readonly File[]) => {
    const metadata = files.map((file) => ({ name: file.name, type: file.type, size: file.size }));
    const checked = checkIdImages(metadata, 4);
    const validFiles = new Set(checked.valid);
    const accepted = files.filter((_, index) => metadata[index] !== undefined && validFiles.has(metadata[index]));
    if (checked.rejected.length) setNotice(checked.rejected.map((item) => item.reason === "type" ? `Đã bỏ qua ${item.file.name}: chỉ nhận ảnh JPG, PNG hoặc WebP.` : `Đã bỏ qua ${item.file.name}: ảnh vượt quá giới hạn 10 MB hoặc quá số lượng tối đa.`).join(" "));
    if (accepted.length) void readIdentityImages(accepted);
  };

  const markOcrFieldTouched = (field: OcrFormField) => {
    setTouchedFields((current) => new Set([...current, field]));
    setOcrFilledFields((current) => { const next = new Set(current); next.delete(field); return next; });
  };

  const readIdentityImages = async (idImages: File[]) => {
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
      setNotice("Đã đọc xong ảnh. Vui lòng kiểm tra các trường được tự điền trước khi lưu hồ sơ.");
    } catch {
      setNotice(controller.signal.aborted ? "Đã hủy thao tác đọc ảnh. Bạn vẫn có thể tiếp tục nhập tay." : "Không đọc được ảnh. Bạn có thể thử lại hoặc tiếp tục nhập thông tin bằng tay.");
    } finally {
      ocrAbort.current = null; setOcrBusy(false); setOcrProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card" onSubmit={(event) => void saveEmployee(event)}>
        <header>
          <h2>{editing ? "Sửa hồ sơ nhân sự" : "Thêm nhân sự"}</h2>
          <button type="button" className="close" onClick={closeForm}>×</button>
        </header>

        {/* 1. Thông tin trên CCCD */}
        <section className="form-section" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); importIdImages(Array.from(event.dataTransfer.files)); }}>
          <div className="form-section-header">
            <div className="form-section-title">
              <span className="form-section-icon"><IdCard className="ico" size={22} aria-hidden="true" /></span>
              <div>
                <h3>Thông tin</h3>
                <p>Thông tin trên căn cước công dân</p>
              </div>
            </div>
            <div className="form-section-actions">
              <input
                ref={idImageInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                style={{ display: "none" }}
                onChange={(event) => {
                  importIdImages(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button type="button" className="ocr-header-btn" disabled={ocrBusy} title="Chọn 1–4 ảnh CCCD (JPG, PNG, WebP) hoặc kéo thả vào khung này" onClick={() => idImageInputRef.current?.click()}>
                {ocrBusy ? "Đang đọc ảnh…" : <><Camera className="ico" size={16} aria-hidden="true" /> Import bằng ảnh</>}
              </button>
            </div>
          </div>
          {(ocrBusy || ocrRejected.length > 0 || ocrMissing.length > 0) && (
            <div className="ocr-reader-inline">
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
            </div>
          )}
          <div className="form-grid">
            <Field label="Họ và tên" name="name" value={form.name} error={errors.name} fromOcr={ocrFilledFields.has("name")} onChange={(value) => { setForm({ ...form, name: value }); markOcrFieldTouched("name"); }} />
            <Field label="Số căn cước công dân" name="cccd" value={form.cccd} error={errors.cccd ?? cccdProvince(form.cccd).error} hint={cccdProvince(form.cccd).hint} fromOcr={ocrFilledFields.has("cccd")} onChange={(value) => { setForm({ ...form, cccd: value }); markOcrFieldTouched("cccd"); }} />
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

            {/* Chỉ hiện trường lý do khi thực sự có cảnh báo không khớp hoặc đã có lý do */}
            {Boolean(form.mismatchOverrideReason || cccdMismatch) && (
              <div style={{ gridColumn: "1 / -1", background: "#fffbeb", padding: "10px 14px", borderRadius: "8px", border: "1px solid #fde68a", marginBottom: "12px" }}>
                <Field
                  label="Lý do xác nhận CCCD không khớp (do công an cấp nhầm / khác giấy tờ)"
                  name="mismatchOverrideReason"
                  value={form.mismatchOverrideReason ?? ""}
                  error={undefined}
                  onChange={(value) => setForm({ ...form, mismatchOverrideReason: value })}
                />
                <small style={{ color: "#92400e" }}>Chỉ điền khi số CCCD thực sự không khớp với năm sinh hoặc giới tính do lỗi cấp phát.</small>
              </div>
            )}

            <Field label="Nguyên quán" name="home" value={form.home} error={errors.home} fromOcr={ocrFilledFields.has("home")} onChange={(value) => { setForm({ ...form, home: value }); markOcrFieldTouched("home"); }} />
            <Field label="Điện thoại" name="phone" value={form.phone} error={errors.phone} fromOcr={ocrFilledFields.has("phone")} onChange={(value) => { setForm({ ...form, phone: value }); markOcrFieldTouched("phone"); }} />
            <Field label="Địa chỉ thường trú" name="address" value={form.address} error={errors.address} fromOcr={ocrFilledFields.has("address")} onChange={(value) => { setForm({ ...form, address: value }); markOcrFieldTouched("address"); }} />
            <Field label="Địa chỉ hiện tại" name="currentAddress" value={form.currentAddress ?? ""} error={errors.currentAddress} fromOcr={ocrFilledFields.has("currentAddress")} onChange={(value) => { setForm({ ...form, currentAddress: value }); markOcrFieldTouched("currentAddress"); }} />
          </div>
        </section>

        {/* 2. Ảnh đại diện 3x4 và prompt chỉnh ảnh */}
        <section className="form-section">
          <div className="form-section-header">
            <div className="form-section-title">
              <span className="form-section-icon"><ImageIcon className="ico" size={22} aria-hidden="true" /></span>
              <div>
                <h3>Ảnh đại diện 3×4</h3>
                <p>Ảnh chân dung nền trắng dùng trên phiếu thông tin</p>
              </div>
            </div>
          </div>
          <div className="photo-documents-row">
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
            <div className="photo-upload-area">
              {form.photo ? (
                <div className="photo-preview-3x4-large">
                  {photoUrl ? <img src={photoUrl} alt="Ảnh thẻ 3x4" /> : <span className="photo-skeleton-hint">Đang tải ảnh…</span>}
                </div>
              ) : (
                <div className="photo-skeleton-large" title="Bấm để tải ảnh chân dung 3×4" onClick={() => photoInputRef.current?.click()}>
                  <span className="photo-skeleton-icon"><UserRound className="ico" size={36} aria-hidden="true" /></span>
                  <span className="photo-skeleton-label">Ảnh thẻ 3×4</span>
                  <small className="photo-skeleton-hint">Bấm để tải ảnh</small>
                </div>
              )}
              {form.photo ? (
                <>
                  <div style={{ display: "flex", gap: "6px", width: "100%" }}>
                    <button type="button" className="button photo-change-btn" disabled={photoAiBusy} onClick={() => photoInputRef.current?.click()}>Đổi ảnh</button>
                    <button type="button" className="button danger photo-change-btn" disabled={photoAiBusy} onClick={removePhoto}>Xóa</button>
                  </div>
                  {photoBeforeAi ? (
                    <button type="button" className="button photo-change-btn" onClick={undoPhotoAi}><Undo2 className="ico" size={14} aria-hidden="true" /> Hoàn tác ảnh AI</button>
                  ) : (
                    <button type="button" className="button primary photo-change-btn" disabled={photoAiBusy} title="AI chỉnh ảnh hiện tại thành ảnh thẻ 3×4 nền trắng" onClick={() => void photoTo3x4()}>
                      {photoAiBusy ? "AI đang chỉnh ảnh…" : <><WandSparkles className="ico" size={14} aria-hidden="true" /> Chỉnh 3×4 bằng AI</>}
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="button photo-change-btn" onClick={() => photoInputRef.current?.click()}>Tải ảnh lên</button>
              )}
            </div>
            <div className="prompt-tab-panel">
              <div className="prompt-tab-header">
                <span className="prompt-tab-title"><Sparkles className="ico" size={14} aria-hidden="true" /> Chỉnh sửa ảnh</span>
                <a className="chatgpt-open-link" href={CHATGPT_PHOTO_URL} target="_blank" rel="noopener noreferrer">Đi đến AI chỉnh ảnh <ExternalLink className="ico" size={12} aria-hidden="true" /></a>
              </div>
              <div className="prompt-tab-body">
                <div className="prompt-box-wrapper">
                  <button
                    type="button"
                    className={promptCopied ? "prompt-copy-btn copied" : "prompt-copy-btn"}
                    onClick={() => void copyPhotoPrompt()}
                  >
                    {promptCopied ? <><Check className="ico" size={12} aria-hidden="true" /> Đã sao chép</> : <><Copy className="ico" size={12} aria-hidden="true" /> Sao chép</>}
                  </button>
                  <pre className="prompt-text-box">{CHATGPT_PHOTO_PROMPT}</pre>
                </div>
                <p className="prompt-hint"><Lightbulb className="ico" size={12} aria-hidden="true" /> Cách nhanh: tải ảnh lên rồi bấm “Chỉnh 3×4 bằng AI”. Hoặc bấm “Đi đến AI chỉnh ảnh”, đính kèm ảnh chụp nhân viên rồi gửi; tải ảnh kết quả về và bấm “Tải ảnh lên”.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Thông tin nhân sự */}
        <section className="form-section">
          <div className="form-section-header">
            <div className="form-section-title">
              <span className="form-section-icon"><BriefcaseBusiness className="ico" size={22} aria-hidden="true" /></span>
              <div>
                <h3>Thông tin nhân sự</h3>
                <p>Mã nhân viên, chức vụ, ngày làm nghề và ngày vào TNM</p>
              </div>
            </div>
          </div>
          <div className="form-grid three-cols">
            <Field label="Mã nhân viên" name="code" value={form.code} error={errors.code} onChange={(value) => setForm({ ...form, code: value })} />
            <label className="field">
              <span>Chức vụ</span>
              <select value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value === "Giám đốc" ? "Giám đốc" : event.target.value === "Nhân sự" ? "Nhân sự" : event.target.value === "Trưởng phòng kỹ thuật" ? "Trưởng phòng kỹ thuật" : event.target.value === "Nhân viên kỹ thuật" ? "Nhân viên kỹ thuật" : "Nhân viên hiện trường" })}>
                <option>Giám đốc</option>
                <option>Nhân sự</option>
                <option>Trưởng phòng kỹ thuật</option>
                <option>Nhân viên kỹ thuật</option>
                <option>Nhân viên hiện trường</option>
              </select>
              {errors.position && <small>{errors.position}</small>}
            </label>
            <Field label="Ngày làm nghề" name="startDate" type="date" value={form.startDate} error={errors.startDate} onChange={(value) => setForm({ ...form, startDate: value })} />
            <Field label="Ngày vào TNM" name="companyStartDate" type="date" value={form.companyStartDate ?? ""} error={errors.companyStartDate} onChange={(value) => setForm({ ...form, companyStartDate: value })} />
            <div className="field employee-signature-field">
              <span>Chữ ký nhân viên (không bắt buộc)</span>
              <BackgroundRemover compact maxWidth={800} currentImage={form.signatureImage} onChange={handleSignatureChange} onRemove={() => setForm((cur) => ({ ...cur, signatureImage: null }))} />
            </div>
            {errors.form && <p className="form-error">{errors.form}</p>}
          </div>
        </section>

        <footer>
          <button className="button" type="button" onClick={closeForm}>Hủy</button>
          <button className="button primary" type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu hồ sơ"}</button>
        </footer>
      </form>
    </div>
  );
}
