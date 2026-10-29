import { useEffect, useRef, useState, type FormEvent } from "react";
import { ScanText, X } from "lucide-react";
import type { Actor } from "../../modules/auth/permissions";
import { isSafetyCertificateType, SAFETY_GROUPS, safetyGroupTitle } from "../../modules/certificates/safetyGroup";
import { systemClock, todayVN } from "../../lib/clock";
import { parseCertificateText } from "../../modules/ocr/parseCertificateText";
import { readDocumentText } from "../../modules/ocr/readDocumentText";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Employee } from "../../modules/employees/types";
import { CertificateFilesField, initialFileItems, splitFileItems, type CertificateFileItem } from "./CertificateFilesField";
import { issueText, type App, type SetNotice } from "./shared";

/** Thêm mới khi cả `editing` lẫn `renewing` đều null. */
export type CertificateFormMode = { type: string; editing: Certificate | null; renewing: Certificate | null; safetyGroup?: number };

const isGroupTitle = (title: string) => /^Nhóm [1-6]$/.test(title.trim());

/** Trạng thái đọc tự động từ tệp chính: đang đọc (kèm %), đã điền, hoặc lỗi. */
type OcrState = { status: "idle" } | { status: "reading"; percent: number } | { status: "done"; filled: string[]; missing: string[]; otherType: string | null } | { status: "error" };
const OCR_LABELS: Readonly<Record<string, string>> = { number: "số", issueDate: "ngày cấp", expiryDate: "ngày hết hạn", title: "tên phân biệt", safetyGroup: "nhóm" };

export function CertificateFormModal(props: { app: App; actor: Actor; employee: Employee; certificateTypes: CertificateTypeRecord[]; existingCertificates: readonly Certificate[]; mode: CertificateFormMode; onClose: () => void; onSaved: (files: Record<string, File>, message: string) => void; setNotice: SetNotice }) {
  const { app, actor, employee: selected, certificateTypes, setNotice } = props;
  const { type: selectedCertificateType, editing: editingCertificate, renewing: renewingCertificate } = props.mode;
  const base = editingCertificate ?? renewingCertificate;
  const type = renewingCertificate?.type ?? editingCertificate?.type ?? selectedCertificateType;
  const typeRecord = certificateTypes.find((item) => item.key === type);
  const typeName = typeRecord?.name ?? "Chứng chỉ";
  // Loại không có thời hạn (bằng cấp…), hoặc tích "không có thời hạn" cho riêng chứng chỉ này: ngày hết hạn để trống
  const typeNoExpiry = typeRecord?.noExpiry === true;
  const [ownNoExpiry, setOwnNoExpiry] = useState(() => !typeNoExpiry && editingCertificate?.expiryDate === null);
  const noExpiry = typeNoExpiry || ownNoExpiry;
  const isSafety = isSafetyCertificateType(type);
  // Nhóm đang có ở chứng chỉ ATLĐ hiện hành khác → không cho chọn trùng
  const takenGroups = new Set(props.existingCertificates.filter((item) => item.state === "current" && isSafetyCertificateType(item.type) && item.id !== base?.id && item.safetyGroup).map((item) => item.safetyGroup as number));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [safetyGroup, setSafetyGroup] = useState<string>(() => String(base?.safetyGroup ?? props.mode.safetyGroup ?? (selected.group && !takenGroups.has(selected.group) ? selected.group : "")));
  const [files, setFiles] = useState<CertificateFileItem[]>(() => initialFileItems(base?.document, base?.supplementaryFiles));
  const customTitle = base && !(isSafety && isGroupTitle(base.title)) ? base.title : "";
  const formRef = useRef<HTMLFormElement | null>(null);
  const [ocr, setOcr] = useState<OcrState>({ status: "idle" });
  const ocrAbort = useRef<AbortController | null>(null);
  const readKeys = useRef(new Set<string>());
  useEffect(() => () => ocrAbort.current?.abort(), []);

  /**
   * Đọc tệp chính (PDF scan / ảnh) rồi điền vào các ô còn trống: số, ngày cấp, ngày hết hạn, tên phân biệt, nhóm ATLĐ.
   * Không đè chữ người dùng đã nhập; ô tự điền được đánh dấu để đối chiếu với giấy gốc.
   */
  const readFromFile = async (file: File) => {
    ocrAbort.current?.abort();
    const controller = new AbortController();
    ocrAbort.current = controller;
    setOcr({ status: "reading", percent: 0 });
    try {
      const text = await readDocumentText(file, controller.signal, ({ page, pages, progress }) => setOcr({ status: "reading", percent: Math.round(((page + progress) / Math.max(1, pages)) * 100) }));
      if (controller.signal.aborted) return;
      const parsed = parseCertificateText(text, { today: todayVN(systemClock) });
      const form = formRef.current;
      if (!form) return;
      const filled: string[] = [];
      const fill = (name: string, value: string | undefined) => {
        const input = form.elements.namedItem(name);
        if (!(input instanceof HTMLInputElement) || !value || input.value.trim()) return;
        input.value = value;
        input.classList.add("ocr-filled");
        filled.push(name);
      };
      fill("number", parsed.number);
      fill("issueDate", parsed.issueDate);
      if (!noExpiry) fill("expiryDate", parsed.expiryDate);
      // ATLĐ: chọn nhóm nếu chưa chọn và nhóm đó chưa có chứng chỉ khác
      if (isSafety && parsed.safetyGroup && !takenGroups.has(parsed.safetyGroup) && !renewingCertificate && (!safetyGroup || !base)) {
        setSafetyGroup(String(parsed.safetyGroup));
        filled.push("safetyGroup");
      }
      // Tên phân biệt chỉ điền khi có thêm thông tin ngoài "Nhóm N" (lĩnh vực, bậc an toàn)
      if (parsed.title && !(isSafety && isGroupTitle(parsed.title))) fill("title", parsed.title);
      const wanted = ["number", "issueDate", ...(noExpiry ? [] : ["expiryDate"])];
      const missing = wanted.filter((name) => !filled.includes(name) && !(form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim());
      const otherType = parsed.kind && parsed.kind !== type ? certificateTypes.find((item) => item.key === parsed.kind)?.name ?? null : null;
      setOcr({ status: "done", filled: filled.map((name) => OCR_LABELS[name] ?? name), missing: missing.map((name) => OCR_LABELS[name] ?? name), otherType });
    } catch {
      if (!controller.signal.aborted) setOcr({ status: "error" });
    }
  };

  // Chọn tệp chính mới → tự đọc một lần
  const primaryFile = files.find((item) => item.primary && item.file);
  useEffect(() => {
    if (!primaryFile?.file || readKeys.current.has(primaryFile.key)) return;
    readKeys.current.add(primaryFile.key);
    void readFromFile(primaryFile.file);
  }, [primaryFile?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Đang lưu: chặn bấm "Lưu" nhiều lần khi mạng chậm (mỗi lần bấm sẽ thêm một chứng chỉ trùng). */
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const saveCertificate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Lưu xong thì giữ khóa: cửa sổ đóng ngay sau đó, không cho gửi lại
      if (!await submitCertificate(event.currentTarget)) { savingRef.current = false; setSaving(false); }
    } catch (error) {
      savingRef.current = false; setSaving(false);
      setErrors({ form: error instanceof Error ? error.message : "Không lưu được chứng chỉ." });
    }
  };
  /** Trả về true khi đã lưu thành công. */
  const submitCertificate = async (form: HTMLFormElement): Promise<boolean> => {
    const formData = new FormData(form);
    const knownType = certificateTypes.find((candidate) => candidate.key === type)?.key;
    if (!knownType) { setNotice("Loại chứng chỉ không hợp lệ."); return false; }
    if (isSafety && !safetyGroup) { setErrors({ safetyGroup: "Chọn nhóm huấn luyện an toàn lao động." }); return false; }
    const { document, supplementaryFiles, newBinaries } = splitFileItems(files);
    if (!document) { setErrors({ document: "Thêm ít nhất một tệp chứng chỉ (tệp chính)." }); return false; }
    // ATLĐ: để trống tên phân biệt → tên tự là "Nhóm N"
    const title = isSafety ? String(formData.get("title") ?? customTitle) : String(formData.get("title") ?? "");
    const certificateInput = {
      type: knownType,
      number: String(formData.get("number") ?? "").trim(),
      issueDate: String(formData.get("issueDate") ?? "") || null,
      expiryDate: ownNoExpiry ? null : String(formData.get("expiryDate") ?? "") || (noExpiry ? null : ""),
      noExpiry: ownNoExpiry,
      document,
      title: renewingCertificate ? renewingCertificate.title : title,
      supplementaryFiles,
      safetyGroup: isSafety ? Number(safetyGroup) : null,
    };
    if (app.certificates.preview) {
      const previewResult = await app.certificates.preview(actor, { ...certificateInput, employeeId: selected.id, ...(editingCertificate ? { id: editingCertificate.id } : renewingCertificate ? { id: renewingCertificate.id } : {}) });
      if (!previewResult.ok) { setErrors(Object.fromEntries(previewResult.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return false; }
      if (previewResult.warnings.length > 0 && !window.confirm(previewResult.warnings.map((item) => issueText(item.code)).join("\n"))) return false;
    }
    const result = renewingCertificate
      ? await app.certificates.renew(actor, { ...certificateInput, id: renewingCertificate.id, expectedVersion: renewingCertificate.version })
      : editingCertificate
        ? await app.certificates.update(actor, { ...certificateInput, id: editingCertificate.id, expectedVersion: editingCertificate.version })
        : await app.certificates.add(actor, { ...certificateInput, employeeId: selected.id });
    if (!result.ok) { setErrors(Object.fromEntries(result.errors.map((item) => [item.field ?? "form", issueText(item.code)]))); return false; }
    props.onSaved(newBinaries, renewingCertificate ? "Đã gia hạn chứng chỉ; bản cũ được lưu trong lịch sử." : editingCertificate ? "Đã cập nhật chứng chỉ." : "Đã thêm chứng chỉ.");
    return true;
  };

  const heading = renewingCertificate ? "Gia hạn chứng chỉ" : editingCertificate ? "Sửa chứng chỉ" : "Thêm chứng chỉ";
  return (
    <div className="modal-backdrop" role="presentation">
      <form ref={formRef} className="modal-card cert-form" onSubmit={(event) => void saveCertificate(event)} aria-labelledby="cert-form-title">
        <header>
          <div><h2 id="cert-form-title">{heading}</h2><p className="muted cert-form-type">{typeName}{base?.title ? ` · ${base.title}` : ""}</p></div>
          <button type="button" className="close" aria-label="Đóng" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="form-grid">
          {isSafety && (
            <fieldset className="field safety-group-field">
              <legend>Nhóm huấn luyện ATVSLĐ <abbr title="Bắt buộc">*</abbr></legend>
              <div className="safety-group-options">
                {SAFETY_GROUPS.map((item) => {
                  const taken = takenGroups.has(item.group);
                  const locked = Boolean(renewingCertificate) && String(item.group) !== safetyGroup;
                  return (
                    <label key={item.group} className={`safety-option${String(item.group) === safetyGroup ? " is-selected" : ""}${taken || locked ? " is-disabled" : ""}`}>
                      <input type="radio" name="safetyGroup" value={item.group} checked={String(item.group) === safetyGroup} disabled={taken || locked} onChange={() => setSafetyGroup(String(item.group))} />
                      <b>{item.label}</b>
                      <small>{taken ? "Đã có chứng chỉ nhóm này" : item.description}</small>
                    </label>
                  );
                })}
              </div>
              <small className="field-help">Theo Nghị định 44/2016/NĐ-CP. Một người có nhiều nhóm thì thêm từng nhóm thành một chứng chỉ riêng.{renewingCertificate ? " Khi gia hạn không đổi nhóm." : ""}</small>
              {errors.safetyGroup && <small>{errors.safetyGroup}</small>}
            </fieldset>
          )}
          {!renewingCertificate && (
            <label className="field">
              <span>Tên phân biệt {isSafety ? "(để trống sẽ là “" + (safetyGroup ? safetyGroupTitle(Number(safetyGroup)) : "Nhóm N") + "”)" : "(nếu có nhiều chứng chỉ cùng loại)"}</span>
              <input name="title" defaultValue={editingCertificate ? customTitle : ""} maxLength={60} />
              {errors.title && <small>{errors.title}</small>}
            </label>
          )}
          <label className="field"><span>Số chứng chỉ</span><input name="number" maxLength={50} placeholder="Để trống nếu giấy không ghi số" defaultValue={editingCertificate?.number ?? ""} />{errors.number && <small>{errors.number}</small>}</label>
          <label className="field"><span>Ngày cấp</span><input name="issueDate" type="date" defaultValue={editingCertificate?.issueDate ?? ""} />{errors.issueDate && <small>{errors.issueDate}</small>}</label>
          <div className="cert-expiry">
            <label className="field"><span>Ngày hết hạn{noExpiry ? "" : <> <abbr title="Bắt buộc">*</abbr></>}</span><input name="expiryDate" type="date" required={!noExpiry} disabled={ownNoExpiry} defaultValue={editingCertificate?.expiryDate ?? ""} />{typeNoExpiry && !errors.expiryDate && <small className="field-help">{typeName} không có thời hạn, để trống là luôn còn hiệu lực.</small>}{errors.expiryDate && <small>{errors.expiryDate}</small>}</label>
            {!typeNoExpiry && <label className="check-field"><input type="checkbox" checked={ownNoExpiry} onChange={(event) => setOwnNoExpiry(event.target.checked)} /> Không có thời hạn (luôn còn hiệu lực)</label>}
          </div>
          <CertificateFilesField items={files} onChange={setFiles} error={errors.document ?? errors.supplementaryFiles} />
          {(ocr.status !== "idle" || primaryFile) && (
            <div className={`ocr-result${ocr.status === "done" && (ocr.otherType || ocr.missing.length) ? " is-warning" : ""}`} role="status">
              <ScanText className="ico" size={16} aria-hidden="true" />
              <div>
                {ocr.status === "reading" && <span>Đang đọc thông tin từ tệp… {ocr.percent}%</span>}
                {ocr.status === "error" && <span>Không đọc được tệp này, vui lòng nhập tay.</span>}
                {ocr.status === "done" && <>
                  <span>{ocr.filled.length ? <>Đã tự điền <b>{ocr.filled.join(", ")}</b> từ tệp. Máy đọc có thể nhầm chữ số, hãy đối chiếu với giấy gốc trước khi lưu.</> : "Không đọc được thông tin nào từ tệp (chữ viết tay hoặc ảnh mờ), vui lòng nhập tay."}</span>
                  {ocr.filled.length > 0 && ocr.missing.length > 0 && <span> Chưa đọc được: {ocr.missing.join(", ")}.</span>}
                  {ocr.otherType && <span> Tệp này có vẻ là <b>{ocr.otherType}</b>, không phải {typeName}.</span>}
                </>}
              </div>
              {primaryFile?.file && ocr.status !== "reading" && <button type="button" className="button" onClick={() => void readFromFile(primaryFile.file!)}>Đọc lại từ tệp</button>}
            </div>
          )}
          {errors.form && <p className="form-error">{errors.form}</p>}
        </div>
        <footer>
          <button className="button" type="button" onClick={props.onClose}>Hủy</button>
          <button className="button primary" type="submit" disabled={saving}>{saving ? "Đang lưu…" : renewingCertificate ? "Gia hạn" : editingCertificate ? "Lưu thay đổi" : "Lưu chứng chỉ"}</button>
        </footer>
      </form>
    </div>
  );
}
