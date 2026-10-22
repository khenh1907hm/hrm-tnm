import { useEffect, useMemo, useState } from "react";
import { ImagePlus, RotateCw, Save, Trash2 } from "lucide-react";
import { randomIds } from "../../lib/ids";
import { rotateImageFile } from "../../lib/image/rotateImage";
import type { Actor } from "../../modules/auth/permissions";
import type { FileRef } from "../../modules/certificates/types";
import type { Employee } from "../../modules/employees/types";
import { IMAGE_FIELDS, isIdCardImage } from "../../modules/excel-template/engine/profileConfig";
import type { ExcelReportTemplate, ProfileCustomFieldKind } from "../../modules/excel-template/types";
import { issueText, type App, type SetNotice } from "./shared";

type ExtraField = { key: string; label: string; kind: ProfileCustomFieldKind; templates: string[] };
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Trường "lưu theo từng nhân sự" của mọi mẫu hồ sơ + vùng ảnh IMG_ (trừ ảnh 3×4 đã có trong hồ sơ). */
export function employeeExtraFields(templates: readonly ExcelReportTemplate[]): ExtraField[] {
  const fields = new Map<string, ExtraField>();
  const add = (key: string, label: string, kind: ProfileCustomFieldKind, templateName: string) => {
    const existing = fields.get(key);
    if (existing) { if (!existing.templates.includes(templateName)) existing.templates.push(templateName); return; }
    fields.set(key, { key, label, kind, templates: [templateName] });
  };
  for (const template of templates) {
    if (!template.profile) continue;
    for (const field of template.profile.customFields) if (field.scope === "employee") add(field.key, field.label, field.kind, template.name);
    for (const slot of template.profile.imageSlots) if (slot.field !== "photo3x4" && slot.field !== "employeeSignature") add(slot.field, IMAGE_FIELDS.find((item) => item.key === slot.field)?.label ?? slot.field, "image", template.name);
  }
  return [...fields.values()];
}

export function EmployeeExtraPanel(props: { app: App; actor: Actor; employee: Employee; templates: readonly ExcelReportTemplate[]; sessionFiles: Readonly<Record<string, File>>; ensureFiles: (refs: { id: string; name: string }[]) => Promise<unknown>; onSaved: (employee: Employee, files: Record<string, File>) => void; setNotice: SetNotice }) {
  const { employee, actor } = props;
  const fields = useMemo(() => employeeExtraFields(props.templates), [props.templates]);
  const canEdit = actor.role === "admin";
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...employee.extraFields }));
  const [pending, setPending] = useState<Record<string, { ref: FileRef; file: File } | null>>({});
  const [busy, setBusy] = useState(false);
  const stored = useMemo(() => employee.extraFiles ?? {}, [employee.extraFiles]);

  // Ảnh đã lưu: tải về để xem trước (chế độ thật)
  const storedRefs = useMemo(() => Object.values(stored).map((ref) => ({ id: ref.id, name: ref.name })), [stored]);
  useEffect(() => { if (storedRefs.length) void props.ensureFiles(storedRefs); }, [storedRefs]); // eslint-disable-line react-hooks/exhaustive-deps

  const previews = useMemo(() => {
    const urls: Record<string, string> = {};
    for (const field of fields.filter((item) => item.kind === "image")) {
      const change = pending[field.key];
      const binary = change === undefined ? (stored[field.key] ? props.sessionFiles[stored[field.key]!.id] : undefined) : change?.file;
      if (binary) urls[field.key] = URL.createObjectURL(binary);
    }
    return urls;
  }, [fields, pending, stored, props.sessionFiles]);
  useEffect(() => () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url)), [previews]);

  if (!fields.length) return null;
  const dirty = JSON.stringify(values) !== JSON.stringify(employee.extraFields ?? {}) || Object.keys(pending).length > 0;

  const putImage = (key: string, file: File) => {
    const id = randomIds().next();
    setPending((current) => ({ ...current, [key]: { ref: { id, name: file.name, mime: file.type, size: file.size }, file } }));
  };

  const chooseImage = async (field: ExtraField, upload: File | undefined) => {
    if (!upload) return;
    if (!IMAGE_TYPES.includes(upload.type) || upload.size > 10 * 1024 * 1024) { props.setNotice("Chỉ nhận ảnh JPG, PNG hoặc WebP tối đa 10 MB.", "warning"); return; }
    try {
      // Ảnh CCCD chụp dọc bằng điện thoại → xoay cho nằm ngang
      putImage(field.key, isIdCardImage(field.key, field.label) ? await rotateImageFile(upload, true) : upload);
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "Không xử lý được ảnh.", "warning");
    }
  };

  const rotateImage = async (key: string) => {
    const change = pending[key];
    const current = change === undefined ? (stored[key] ? props.sessionFiles[stored[key]!.id] : undefined) : change?.file;
    if (!current) return;
    try {
      putImage(key, await rotateImageFile(current));
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "Không xoay được ảnh.", "warning");
    }
  };

  const save = async () => {
    setBusy(true);
    const fieldValues = Object.fromEntries(fields.filter((field) => field.kind !== "image").map((field) => [field.key, values[field.key] ?? ""]));
    const files = Object.fromEntries(Object.entries(pending).map(([key, change]) => [key, change ? change.ref : null]));
    const result = await props.app.employees.updateExtra(actor, { id: employee.id, expectedVersion: employee.version, fields: fieldValues, files });
    setBusy(false);
    if (!result.ok) { props.setNotice(issueText(result.errors[0]?.code ?? "EMP_EXTRA_INVALID")); return; }
    const binaries = Object.fromEntries(Object.values(pending).filter((change): change is { ref: FileRef; file: File } => change !== null).map((change) => [change.ref.id, change.file]));
    setPending({});
    props.onSaved(result.value, binaries);
  };

  return (
    <section className="panel detail-panel extra-panel">
      <div className="page-head">
        <div><h2>Thông tin bổ sung cho mẫu hồ sơ</h2><p>Các trường được định nghĩa trong mẫu hồ sơ, lưu riêng cho {employee.name}.</p></div>
        {canEdit && <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}><Save className="ico" size={16} aria-hidden="true" /> {busy ? "Đang lưu…" : "Lưu thông tin bổ sung"}</button>}
      </div>
      <div className="extra-grid">
        {fields.map((field) => {
          const hint = `Dùng trong: ${field.templates.join(", ")}`;
          if (field.kind === "image") {
            const has = pending[field.key] === undefined ? Boolean(stored[field.key]) : pending[field.key] !== null;
            return (
              <div className="field extra-image" key={field.key}>
                <span>{field.label}</span>
                <div className="extra-image-box">
                  {previews[field.key] ? <img src={previews[field.key]} alt={field.label} /> : <span className="muted">{has ? "Đang tải ảnh…" : "Chưa có ảnh"}</span>}
                </div>
                {canEdit && <div className="button-row">
                  <label className="button"><ImagePlus className="ico" size={14} aria-hidden="true" /> {has ? "Đổi ảnh" : "Tải ảnh"}<input type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(event) => { void chooseImage(field, event.target.files?.[0]); event.target.value = ""; }} /></label>
                  {previews[field.key] && <button type="button" className="button" title="Xoay 90° theo chiều kim đồng hồ" onClick={() => void rotateImage(field.key)}><RotateCw className="ico" size={14} aria-hidden="true" /> Xoay ảnh</button>}
                  {has && <button type="button" className="button danger" onClick={() => setPending({ ...pending, [field.key]: null })}><Trash2 className="ico" size={14} aria-hidden="true" /> Xóa ảnh</button>}
                </div>}
                <small className="field-help">{hint}</small>
              </div>
            );
          }
          if (field.kind === "checkbox") return (
            <label className="check-field extra-check" key={field.key}><input type="checkbox" disabled={!canEdit} checked={values[field.key] === "true"} onChange={(event) => setValues({ ...values, [field.key]: event.target.checked ? "true" : "" })} /> {field.label}<small className="field-help">{hint}</small></label>
          );
          return (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              <input type={field.kind === "date" ? "date" : "text"} disabled={!canEdit} maxLength={500} value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
              <small className="field-help">{hint}</small>
            </label>
          );
        })}
      </div>
    </section>
  );
}
