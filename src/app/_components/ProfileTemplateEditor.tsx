import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { SYSTEM_FIELDS } from "../../modules/excel-template/engine/fieldValues";
import { IMAGE_FIELDS, isCertificateKey, isCustomKey } from "../../modules/excel-template/engine/profileConfig";
import type { ProfileImageSlot, ProfileTemplateConfig } from "../../modules/excel-template/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

type CertificateTypeOption = { key: string; name: string };

/** Cài đặt "Mẫu hồ sơ": trường tùy chỉnh, vùng ảnh, chứng chỉ đính kèm và vùng in. */
export function ProfileTemplateEditor(props: { value: ProfileTemplateConfig; onChange: (value: ProfileTemplateConfig) => void; certificateTypes: readonly CertificateTypeOption[] }) {
  const { value, onChange, certificateTypes } = props;
  const systemUsed = value.placeholders.filter((key) => !isCustomKey(key) && !isCertificateKey(key));
  const certificateUsed = value.placeholders.filter(isCertificateKey);
  const typeName = (key: string) => certificateTypes.find((type) => type.key === key)?.name ?? key;

  const updateSlot = (index: number, patch: Partial<ProfileImageSlot>) => onChange({ ...value, imageSlots: value.imageSlots.map((slot, i) => i === index ? { ...slot, ...patch } : slot) });
  const moveAttachment = (index: number, direction: -1 | 1) => {
    const next = [...value.attachments];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...value, attachments: next });
  };

  return (
    <div className="profile-editor">
      <section>
        <h3>Trường nhận diện trong mẫu <small>(sheet “{value.sheetName}”)</small></h3>
        <p className="muted">Gõ <code>{"{{tên trường}}"}</code> vào ô trong Excel. Trường hệ thống tự lấy từ hồ sơ nhân sự.</p>
        <div className="profile-chips">
          {systemUsed.map((key) => <span className="pill ok" key={key}>{SYSTEM_FIELDS.find((field) => field.key === key)?.label ?? key}</span>)}
          {certificateUsed.map((key) => <span className="pill ok" key={key}>☑ {typeName(key.slice(5))}</span>)}
          {!systemUsed.length && !certificateUsed.length && <span className="muted">Chưa có trường hệ thống nào.</span>}
        </div>
      </section>

      <CustomFieldsEditor value={value} onChange={onChange} />

      <section>
        <h3>Vùng ảnh</h3>
        <p className="muted">Trong Excel, chọn vùng ô rồi đặt tên vùng (Name Box) là <code>IMG_photo3x4</code> hoặc <code>IMG_cccdImage</code> — app tự nhận. Hoặc nhập trực tiếp dưới đây.</p>
        <table className="profile-table">
          <thead><tr><th>Ảnh</th><th>Vùng ô</th><th>Cách đặt</th><th /></tr></thead>
          <tbody>
            {value.imageSlots.map((slot, index) => (
              <tr key={`${slot.field}-${index}`}>
                <td>
                  <select aria-label="Loại ảnh" value={slot.field} onChange={(event) => updateSlot(index, { field: event.target.value })}>
                    {IMAGE_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                  </select>
                </td>
                <td><input aria-label="Vùng ô ảnh" value={slot.range} placeholder="E8:K16" onChange={(event) => updateSlot(index, { range: event.target.value.toUpperCase() })} /></td>
                <td>
                  <select aria-label="Cách đặt ảnh" value={slot.fit} onChange={(event) => updateSlot(index, { fit: event.target.value === "cover" ? "cover" : "contain" })}>
                    <option value="contain">Vừa khung (giữ tỉ lệ)</option><option value="cover">Lấp đầy (cắt phần thừa)</option>
                  </select>
                </td>
                <td><button type="button" className="button danger" onClick={() => onChange({ ...value, imageSlots: value.imageSlots.filter((_, i) => i !== index) })}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="button" onClick={() => onChange({ ...value, imageSlots: [...value.imageSlots, { field: "photo3x4", range: "", fit: "cover" }] })}><Plus className="ico" size={14} aria-hidden="true" /> Thêm vùng ảnh</button>
      </section>

      <section>
        <h3>Chứng chỉ đính kèm (thứ tự in sau phiếu)</h3>
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
        <label className="field" style={{ maxWidth: "260px" }}>
          <span>Vùng in của phiếu (1 trang)</span>
          <input value={value.printArea} onChange={(event) => onChange({ ...value, printArea: event.target.value.toUpperCase() })} />
        </label>
      </section>
    </div>
  );
}
