import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, Maximize2, Minimize2, Plus } from "lucide-react";
import { SYSTEM_FIELDS } from "../../modules/excel-template/engine/fieldValues";
import type { AiTemplateMerge } from "../../modules/excel-template/engine/mappingPlan";
import { fieldKeyFromLabel, IMAGE_FIELDS, isCertificateKey, isCustomKey, profileConfigFromScan } from "../../modules/excel-template/engine/profileConfig";
import { scanTemplate } from "../../modules/excel-template/engine/scanTemplate";
import { placeFieldCodes, removeFieldCode, templateFieldCatalog } from "../../modules/excel-template/engine/templateEdits";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../../modules/excel-template/templateStorage";
import type { ProfileCustomField, ProfileImageSlot, ProfileTemplateConfig } from "../../modules/excel-template/types";
import type { Partner } from "../../modules/partners/types";
import type { Signature } from "../../modules/signatures/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import type { SignatureFileLoader } from "./SignerPicker";
import { TemplateAiSetup } from "./TemplateAiSetup";
import { TemplateCellPanel, type CellAssignment } from "./TemplateCellPanel";
import { TemplatePreview, type PreviewRegion, type PreviewSelection } from "./TemplatePreview";
import { TemplateSignerSection } from "./TemplateSignerSection";

type CertificateTypeOption = { key: string; name: string };

/** Cài đặt "Mẫu hồ sơ": trường tùy chỉnh, vùng ảnh, chứng chỉ đính kèm và vùng in. */
export function ProfileTemplateEditor(props: { value: ProfileTemplateConfig; onChange: (value: ProfileTemplateConfig) => void; certificateTypes: readonly CertificateTypeOption[]; partners?: readonly Partner[]; signatures?: readonly Signature[] | null; loadSignatureFile?: SignatureFileLoader | undefined; fileBase64?: string | undefined; onFileChange?: ((fileBase64: string) => void) | undefined }) {
  const { value, onChange, certificateTypes } = props;
  const typeName = (key: string) => certificateTypes.find((type) => type.key === key)?.name ?? key;

  // Xem trước: mục cấu hình đang trỏ chuột / đang nhập → vùng tương ứng trên ảnh phiếu sáng lên
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const previewIdOf = (target: EventTarget) => (target instanceof HTMLElement ? target.closest<HTMLElement>("[data-preview]")?.dataset.preview ?? null : null);
  const regions = useMemo<PreviewRegion[]>(() => [
    ...value.placeholders.map((key): PreviewRegion => isCertificateKey(key)
      ? { id: `key:${key}`, label: `Ô chứng chỉ ${typeName(key.slice(5))}`, tone: "field", placeholder: key }
      : isCustomKey(key)
        ? { id: `key:${key}`, label: value.customFields.find((field) => field.key === key)?.label ?? key, tone: "custom", placeholder: key }
        : { id: `key:${key}`, label: SYSTEM_FIELDS.find((field) => field.key === key)?.label ?? key, tone: key.startsWith("signer") ? "signer" : "field", placeholder: key }),
    ...value.imageSlots.map((slot, index): PreviewRegion => ({ id: `slot:${index}`, label: IMAGE_FIELDS.find((field) => field.key === slot.field)?.label ?? slot.field, tone: slot.field === "signature" ? "signer" : "image", range: slot.range })),
    ...value.customFields.filter((field) => field.target).map((field): PreviewRegion => ({ id: `custom:${field.key}`, label: field.label, tone: "custom", range: field.target! })),
    { id: "print", label: "Vùng in", tone: "print", range: value.printArea },
  ], [value, certificateTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sửa ngay trên ảnh phiếu: chọn ô → gán dữ liệu. Trường hồ sơ ghi mã {{…}} thẳng vào file mẫu trong app
  // (không phải tải file về sửa rồi tải lên lại); ảnh, ô nhập thêm, vùng in chỉ lưu trong cấu hình.
  const catalog = useMemo(() => templateFieldCatalog(certificateTypes), [certificateTypes]);
  const [selection, setSelection] = useState<PreviewSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [cellError, setCellError] = useState("");
  const regionLabel = (id: string) => regions.find((region) => region.id === id)?.label ?? id;
  const editable = Boolean(props.fileBase64 && props.onFileChange);
  /** Sửa file mẫu rồi đọc lại để danh sách trường khớp đúng file; `patch` sửa thêm phần cấu hình. */
  const rewrite = async (edit: (bytes: Uint8Array) => Promise<Uint8Array>, patch: (config: ProfileTemplateConfig) => ProfileTemplateConfig = (config) => config) => {
    const bytes = await edit(base64ToUint8Array(props.fileBase64!));
    const next = profileConfigFromScan(await scanTemplate(bytes), value);
    props.onFileChange!(uint8ArrayToBase64(bytes));
    // Ghi mã chỉ đổi các ô {{…}}: giữ nguyên vùng ảnh đang cài (không lấy lại vùng tên IMG_ người dùng đã xóa)
    onChange(patch({ ...next, sheetName: value.sheetName, imageSlots: value.imageSlots }));
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setCellError("");
    try { await work(); } catch { setCellError("Không ghi được vào file mẫu, thử lại."); } finally { setBusy(false); }
  };
  const withImage = (config: ProfileTemplateConfig, field: string, range: string): ProfileTemplateConfig => ({ ...config, imageSlots: [...config.imageSlots.filter((slot) => slot.field !== field), { field, range, fit: "stretch", custom: true }] });
  const withCustom = (config: ProfileTemplateConfig, cell: string, label: string, kind: ProfileCustomField["kind"]): ProfileTemplateConfig => {
    const key = fieldKeyFromLabel(label, [...config.placeholders, ...config.customFields.map((field) => field.key)]);
    // Ảnh mới (logo, ảnh dự án) mặc định cố định theo mẫu: tải ảnh một lần ở mục "Ô nhập thêm"
    return { ...config, customFields: [...config.customFields, { key, label, kind, target: cell, scope: kind === "image" ? "template" : "export", defaultValue: "" }] };
  };
  const assign = (assignment: CellAssignment) => {
    if (!selection) return;
    const { range } = selection;
    const first = range.split(":")[0]!;
    void run(async () => {
      if (assignment.type === "field") {
        await rewrite((bytes) => placeFieldCodes(bytes, value.sheetName, [{ cell: first, field: assignment.field, mode: assignment.mode }]));
        setFocused(`key:${assignment.field}`);
      } else if (assignment.type === "image") onChange(withImage(value, assignment.field, range));
      else if (assignment.type === "custom") onChange(withCustom(value, assignment.kind === "image" ? range : first, assignment.label, assignment.kind));
      else onChange({ ...value, printArea: range });
      setSelection(null);
    });
  };
  const removeRegion = (id: string) => {
    if (!selection) return;
    const { range } = selection;
    void run(async () => {
      if (id.startsWith("key:")) await rewrite((bytes) => removeFieldCode(bytes, value.sheetName, id.slice(4), range));
      else if (id.startsWith("slot:")) onChange({ ...value, imageSlots: value.imageSlots.filter((_, index) => `slot:${index}` !== id) });
      else if (id.startsWith("custom:")) onChange({ ...value, customFields: value.customFields.filter((field) => `custom:${field.key}` !== id) });
      setSelection({ ...selection, regionIds: selection.regionIds.filter((item) => item !== id) });
    });
  };
  // File Excel AI trả về: mã đã được ghi vào file gốc (mergeAiTemplate); ở đây đọc lại file và thêm vùng ảnh, vùng in
  const applyAi = (merge: AiTemplateMerge) => run(async () => {
    const next = profileConfigFromScan(await scanTemplate(merge.bytes), value);
    props.onFileChange!(uint8ArrayToBase64(merge.bytes));
    let config: ProfileTemplateConfig = { ...next, imageSlots: value.imageSlots, ...(merge.printArea ? { printArea: merge.printArea } : {}) };
    for (const image of merge.images) {
      if (IMAGE_FIELDS.some((field) => field.key === image.field)) config = withImage(config, image.field, image.range);
      // Ảnh mới (IMG_logoNhaThau…) → ô nhập thêm kiểu ảnh cố định theo mẫu
      else if (!config.customFields.some((field) => field.key === image.field)) config = { ...config, customFields: [...config.customFields, { key: image.field, label: image.field, kind: "image", target: image.range, scope: "template", defaultValue: "" }] };
    }
    onChange(config);
  });
  // Mở rộng ảnh phiếu: phóng từ đúng chỗ đang đứng ra gần kín màn hình (FLIP: đo vị trí cũ/mới rồi chạy transform)
  const [expanded, setExpanded] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const fromRect = useRef<DOMRect | null>(null);
  const toggleExpanded = () => { fromRect.current = asideRef.current?.getBoundingClientRect() ?? null; setExpanded((open) => !open); };
  useLayoutEffect(() => {
    const aside = asideRef.current, from = fromRect.current;
    fromRect.current = null;
    if (!aside || !from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = aside.getBoundingClientRect();
    aside.animate([
      { transformOrigin: "0 0", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { transformOrigin: "0 0", transform: "none" },
    ], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      fromRect.current = asideRef.current?.getBoundingClientRect() ?? null;
      setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  const signatureIndex = value.imageSlots.findIndex((slot) => slot.field === "signature");

  // Sửa trong app → đánh dấu để lần tải lại file Excel sau không ghi đè
  const updateSlot = (index: number, patch: Partial<ProfileImageSlot>) => onChange({ ...value, imageSlots: value.imageSlots.map((slot, i) => i === index ? { ...slot, ...patch, custom: true } : slot) });
  const moveAttachment = (index: number, direction: -1 | 1) => {
    const next = [...value.attachments];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...value, attachments: next });
  };

  return (
    <div className={props.fileBase64 ? "profile-editor-layout" : undefined}>
    <div
      className="profile-editor"
      ref={editorRef}
      // Giữ mục vừa rê tới khi chuột đi qua khoảng trống giữa các mục (không tắt/bật liên tục)
      onMouseOver={(event: MouseEvent) => { const id = previewIdOf(event.target); if (id) setHovered(id); }}
      onMouseLeave={() => setHovered(null)}
      onFocus={(event: FocusEvent) => setFocused(previewIdOf(event.target))}
    >
      <div data-preview={signatureIndex >= 0 ? `slot:${signatureIndex}` : "key:signerTitle"}>
        <TemplateSignerSection value={value} onChange={onChange} signatures={props.signatures ?? null} loadSignatureFile={props.loadSignatureFile} />
      </div>

      <section>
        <h3>2. Ảnh nhân sự trên phiếu</h3>
        <p className="muted">Vùng ô đặt ảnh 3×4 hoặc ảnh CCCD, ví dụ <code>E8:K16</code> (hoặc kéo chuột chọn khung ảnh trên ảnh phiếu). Ảnh luôn lấp đầy đúng vùng ô này. App tự đọc từ vùng tên <code>IMG_photo3x4</code>, <code>IMG_cccdImage</code> trong Excel; sửa ở đây thì giữ theo giá trị bạn nhập, tải lại file cũng không mất. Ảnh chữ ký cài ở mục 1.</p>
        <table className="profile-table">
          <thead><tr><th>Ảnh</th><th>Vùng ô (ảnh lấp đầy vùng này)</th><th /></tr></thead>
          <tbody>
            {value.imageSlots.map((slot, index) => slot.field === "signature" ? null : (
              <tr key={`${slot.field}-${index}`} data-preview={`slot:${index}`}>
                <td>
                  <select aria-label="Loại ảnh" value={slot.field} onChange={(event) => updateSlot(index, { field: event.target.value })}>
                    {IMAGE_FIELDS.filter((field) => field.key !== "signature").map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                  </select>
                </td>
                <td><input aria-label="Vùng ô ảnh" value={slot.range} placeholder="E8:K16" onChange={(event) => updateSlot(index, { range: event.target.value.toUpperCase() })} /></td>
                <td><button type="button" className="button danger" onClick={() => onChange({ ...value, imageSlots: value.imageSlots.filter((_, i) => i !== index) })}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="button" onClick={() => onChange({ ...value, imageSlots: [...value.imageSlots, { field: "photo3x4", range: "", fit: "stretch", custom: true }] })}><Plus className="ico" size={14} aria-hidden="true" /> Thêm vùng ảnh</button>
      </section>

      <CustomFieldsEditor value={value} onChange={onChange} partners={props.partners} />

      <section>
        <h3>4. Chứng chỉ đính kèm <small>(in sau phiếu, theo thứ tự này)</small></h3>
        <div className="profile-attachments">
          {value.attachments.map((key, index) => (
            <div className="profile-attachment" key={key}>
              <span>{index + 1}. {typeName(key)}</span>
              <button type="button" className="button" aria-label={`Chuyển ${typeName(key)} lên`} onClick={() => moveAttachment(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
              <button type="button" className="button" aria-label={`Chuyển ${typeName(key)} xuống`} onClick={() => moveAttachment(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
              <button type="button" className="button danger" onClick={() => onChange({ ...value, attachments: value.attachments.filter((item) => item !== key) })}>Bỏ</button>
            </div>
          ))}
          {certificateTypes.filter((type) => !value.attachments.includes(type.key)).map((type) => (
            <button type="button" className="button" key={type.key} onClick={() => onChange({ ...value, attachments: [...value.attachments, type.key] })}><Plus className="ico" size={14} aria-hidden="true" /> {type.name}</button>
          ))}
        </div>
      </section>

      <section>
        <label className="field" style={{ maxWidth: "260px" }} data-preview="print">
          <span>5. Vùng in của phiếu (1 trang)</span>
          <input value={value.printArea} onChange={(event) => onChange({ ...value, printArea: event.target.value.toUpperCase() })} />
        </label>
      </section>

      {editable && <TemplateAiSetup catalog={catalog} fileBase64={props.fileBase64!} sheetName={value.sheetName} busy={busy} onApply={applyAi} />}
    </div>
    {props.fileBase64 && (
      <>
      {expanded && <div className="preview-backdrop" onClick={toggleExpanded} />}
      <aside className={`profile-editor-preview${expanded ? " is-expanded" : ""}`} aria-label="Xem trước phiếu" ref={asideRef}>
        <div className="profile-editor-preview-head">
          <h3>Xem trước phiếu</h3>
          <button type="button" className="button preview-expand" onClick={toggleExpanded} aria-label={expanded ? "Thu nhỏ ảnh phiếu" : "Mở rộng ảnh phiếu"} title={expanded ? "Thu nhỏ (Esc)" : "Mở rộng"}>
            {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span>{expanded ? "Thu nhỏ" : "Mở rộng"}</span>
          </button>
        </div>
        <p className="muted">{editable ? "Bấm một ô (hoặc kéo chuột chọn nhiều ô) để chọn dữ liệu điền vào. " : ""}Rê chuột vào một mục bên trái, vùng tương ứng trên phiếu sẽ sáng lên.</p>
        <TemplatePreview fileBase64={props.fileBase64} sheetName={value.sheetName} printArea={value.printArea} regions={regions} active={hovered ?? (selection?.regionIds[0] ?? focused)} selection={selection?.range ?? null}
          overlay={selection ? <TemplateCellPanel key={selection.range} selection={selection} catalog={catalog} regionLabel={regionLabel} busy={busy} error={cellError} onAssign={assign} onRemove={removeRegion} onClose={() => setSelection(null)} /> : null}
          {...(editable ? { onSelect: (next: PreviewSelection) => { setSelection(next); setCellError(""); } } : {})} />
      </aside>
      </>
    )}
    </div>
  );
}
