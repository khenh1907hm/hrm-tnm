import { useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { parseRange } from "../../modules/excel-template/engine/fillWorkbook";
import { fieldKeyFromLabel } from "../../modules/excel-template/engine/profileConfig";
import type { ProfileCustomField, ProfileCustomFieldKind, ProfileFieldScope, ProfileTemplateConfig } from "../../modules/excel-template/types";
import type { Partner } from "../../modules/partners/types";

const KIND_LABELS: Record<ProfileCustomFieldKind, string> = { text: "Chữ", date: "Ngày (dd/mm/yyyy)", checkbox: "Ô đánh dấu ☑/☐", image: "Ảnh" };
const SCOPE_LABELS: Record<ProfileFieldScope, string> = { employee: "Lưu theo từng nhân sự", template: "Cố định theo mẫu", export: "Nhập khi xuất" };
const MAX_FIXED_IMAGE = 2 * 1024 * 1024;

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });

/** Kiểm tra ô đích: trường ảnh cần vùng ô, trường khác cần đúng một ô. */
function targetError(kind: ProfileCustomFieldKind, target: string): string | null {
  if (!target.trim()) return kind === "image" ? "Nhập vùng ô đặt ảnh, vd C19:Z33." : "Nhập ô cần điền, vd B12.";
  try {
    const [start, end] = parseRange(target);
    if (kind !== "image" && (start.col !== end.col || start.row !== end.row)) return "Trường chữ/ngày/ô đánh dấu chỉ gắn vào một ô, vd B12.";
    return null;
  } catch { return "Ô không hợp lệ. Ví dụ đúng: B12 hoặc C19:Z33."; }
}

/** Danh sách trường tùy chỉnh của mẫu + form tự thêm trường gắn vào ô bất kỳ (không cần sửa file Excel). */
export function CustomFieldsEditor(props: { value: ProfileTemplateConfig; onChange: (value: ProfileTemplateConfig) => void; partners?: readonly Partner[] | undefined }) {
  const partnersWithImage = (props.partners ?? []).filter((partner) => partner.image);
  const { value, onChange } = props;
  const [draft, setDraft] = useState<{ label: string; kind: ProfileCustomFieldKind; target: string; scope: ProfileFieldScope }>({ label: "", kind: "text", target: "", scope: "employee" });
  const [draftError, setDraftError] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const update = (key: string, patch: Partial<ProfileCustomField>) => onChange({ ...value, customFields: value.customFields.map((field) => field.key === key ? { ...field, ...patch } : field) });
  const remove = (key: string) => onChange({ ...value, customFields: value.customFields.filter((field) => field.key !== key) });

  const add = () => {
    const label = draft.label.trim();
    if (!label) { setDraftError("Nhập tên trường."); return; }
    const problem = targetError(draft.kind, draft.target);
    if (problem) { setDraftError(problem); return; }
    const key = fieldKeyFromLabel(label, [...value.placeholders, ...value.customFields.map((field) => field.key)]);
    onChange({ ...value, customFields: [...value.customFields, { key, label, kind: draft.kind, target: draft.target.trim().toUpperCase(), scope: draft.scope, defaultValue: "" }] });
    setDraft({ label: "", kind: draft.kind, target: "", scope: draft.scope });
    setDraftError("");
  };

  const uploadFixedImage = async (key: string, file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_FIXED_IMAGE) { setRowError({ ...rowError, [key]: "Chỉ nhận ảnh PNG/JPG tối đa 2 MB." }); return; }
    setRowError({ ...rowError, [key]: "" });
    update(key, { defaultValue: await readAsDataUrl(file) });
  };

  const defaultInput = (field: ProfileCustomField) => {
    const scope = field.scope ?? "export";
    if (scope === "employee") return <span className="muted">Nhập trong hồ sơ từng nhân sự</span>;
    if (field.kind === "image") return (
      <div className="fixed-image">
        {field.defaultValue ? <img src={field.defaultValue} alt={`Ảnh ${field.label}`} /> : <span className="muted">Chưa có ảnh</span>}
        <label className="button"><ImagePlus className="ico" size={14} aria-hidden="true" /> {field.defaultValue ? "Đổi ảnh" : "Tải ảnh"}<input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { void uploadFixedImage(field.key, event.target.files?.[0]); event.target.value = ""; }} /></label>
        {/* Thay nhanh ảnh dự án bằng ảnh của một đối tác đã lưu */}
        {partnersWithImage.length > 0 && (
          <select aria-label={`Ảnh đối tác cho ${field.label}`} value={partnersWithImage.find((partner) => partner.image === field.defaultValue)?.id ?? ""}
            onChange={(event) => { const partner = partnersWithImage.find((item) => item.id === event.target.value); if (partner) { setRowError({ ...rowError, [field.key]: "" }); update(field.key, { defaultValue: partner.image }); } }}>
            <option value="" disabled>Ảnh đối tác…</option>
            {partnersWithImage.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
          </select>
        )}
      </div>
    );
    if (field.kind === "checkbox") return <input type="checkbox" aria-label={`Mặc định ${field.label}`} checked={field.defaultValue === "true"} onChange={(event) => update(field.key, { defaultValue: event.target.checked ? "true" : "" })} />;
    return <input aria-label={`Mặc định ${field.label}`} type={field.kind === "date" ? "date" : "text"} value={field.defaultValue} onChange={(event) => update(field.key, { defaultValue: event.target.value })} />;
  };

  return (
    <section>
      <h3>4. Ô nhập thêm <small>(ngày bắt đầu dự án, logo/ảnh dự án…)</small></h3>
      <p className="muted">Thông tin không có sẵn trong hồ sơ. Gõ <code>{"{{mã}}"}</code> vào ô trong Excel, hoặc bấm <b>Thêm trường</b> bên dưới rồi chọn ô cần điền, không cần sửa file Excel.</p>
      {value.customFields.length > 0 && (
        <div className="table-scroll">
          <table className="profile-table custom-fields-table">
            <thead><tr><th>Tên hiển thị</th><th>Kiểu</th><th>Gắn vào</th><th>Giá trị lấy từ</th><th>Giá trị / ảnh mặc định</th><th><span className="sr-only">Xóa</span></th></tr></thead>
            <tbody>
              {value.customFields.map((field) => (
                <tr key={field.key} data-preview={field.target ? `custom:${field.key}` : `key:${field.key}`}>
                  <td><input aria-label={`Tên hiển thị ${field.key}`} value={field.label} onChange={(event) => update(field.key, { label: event.target.value })} /></td>
                  <td>
                    <select aria-label={`Kiểu ${field.label}`} value={field.kind} onChange={(event) => update(field.key, { kind: event.target.value as ProfileCustomFieldKind, defaultValue: "" })}>
                      {(Object.keys(KIND_LABELS) as ProfileCustomFieldKind[]).filter((kind) => kind !== "image" || field.target).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                    </select>
                  </td>
                  <td>{field.target
                    ? <><input aria-label={`Ô gắn ${field.label}`} value={field.target} onChange={(event) => update(field.key, { target: event.target.value.toUpperCase() })} />{targetError(field.kind, field.target) && <small className="form-error">{targetError(field.kind, field.target)}</small>}</>
                    : <code title="Mã gõ trong file Excel">{`{{${field.key}}}`}</code>}</td>
                  <td>
                    <select aria-label={`Nguồn giá trị ${field.label}`} value={field.scope ?? "export"} onChange={(event) => update(field.key, { scope: event.target.value as ProfileFieldScope })}>
                      {(Object.keys(SCOPE_LABELS) as ProfileFieldScope[]).map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
                    </select>
                  </td>
                  <td>{defaultInput(field)}{rowError[field.key] && <small className="form-error">{rowError[field.key]}</small>}</td>
                  <td>{field.target && <button type="button" className="button danger icon-button" aria-label={`Xóa trường ${field.label}`} onClick={() => remove(field.key)}><Trash2 size={16} aria-hidden="true" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="add-field">
        <b>Thêm trường</b>
        <label className="field"><span>Tên trường</span><input value={draft.label} placeholder="vd: Logo nhà thầu, Số thẻ công trường" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label className="field"><span>Kiểu</span><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ProfileCustomFieldKind })}>{(Object.keys(KIND_LABELS) as ProfileCustomFieldKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}</select></label>
        <label className="field"><span>{draft.kind === "image" ? "Vùng ô đặt ảnh" : "Ô cần điền"}</span><input value={draft.target} placeholder={draft.kind === "image" ? "vd: C19:Z33" : "vd: B12"} onChange={(event) => setDraft({ ...draft, target: event.target.value })} /></label>
        <label className="field"><span>Giá trị lấy từ</span><select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as ProfileFieldScope })}>{(Object.keys(SCOPE_LABELS) as ProfileFieldScope[]).map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}</select></label>
        <button type="button" className="button primary" onClick={add}><Plus className="ico" size={16} aria-hidden="true" /> Thêm trường</button>
        {draftError && <p className="form-error" role="alert">{draftError}</p>}
      </div>
    </section>
  );
}
