import { Fragment, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { CATALOG_GROUP_LABELS, type CatalogField, type PlacementMode } from "../../modules/excel-template/engine/templateEdits";
import type { Partner } from "../../modules/partners/types";
import { MAX_FIXED_IMAGE, readAsDataUrl } from "./CustomFieldsEditor";
import type { PreviewSelection } from "./TemplatePreview";

/** Gán cho vùng ô đang chọn: một trường hồ sơ (ghi mã vào ô), một ảnh (lấp đầy vùng), một ô nhập thêm, hoặc làm vùng in. */
export type CellAssignment =
  | { type: "field"; field: string; mode: PlacementMode }
  | { type: "image"; field: string }
  | { type: "custom"; label: string; kind: "text" | "date" | "checkbox" | "image"; image?: string }
  | { type: "print" };

/** Bảng nhỏ trên ảnh xem trước: ô đang chọn có gì, gỡ ra, hoặc chọn dữ liệu cần điền vào. */
export function TemplateCellPanel(props: {
  selection: PreviewSelection;
  catalog: readonly CatalogField[];
  partners?: readonly Partner[] | undefined;
  regionLabel: (id: string) => string;
  busy: boolean;
  error: string;
  onAssign: (assignment: CellAssignment) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const { selection, catalog } = props;
  const partnersWithImage = (props.partners ?? []).filter((partner) => partner.image);
  const [choice, setChoice] = useState("");
  const [mode, setMode] = useState<PlacementMode>("append");
  const [customLabel, setCustomLabel] = useState("");
  const [customKind, setCustomKind] = useState<"text" | "date" | "checkbox" | "image">(selection.range.includes(":") ? "image" : "text");
  // Ảnh cho ô nhập thêm kiểu ảnh: lấy ảnh đối tác (logo thầu…) hoặc tải ảnh lên ngay tại đây
  const [customImage, setCustomImage] = useState("");
  const [imageError, setImageError] = useState("");
  // Chữ có sẵn trong ô (bỏ các mã đã gán) → hỏi thay cả ô hay điền sau chữ
  const label = selection.text.replace(/\{\{[^{}]*\}\}/g, "").trim();
  const field = choice.startsWith("f:") ? catalog.find((item) => item.key === choice.slice(2)) : undefined;
  const partner = choice.startsWith("p:") ? partnersWithImage.find((item) => item.id === choice.slice(2)) : undefined;
  const isImage = field?.kind === "image";
  const multi = selection.range.includes(":");

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_FIXED_IMAGE) { setImageError("Chỉ nhận ảnh PNG/JPG tối đa 2 MB."); return; }
    setImageError("");
    setCustomImage(await readAsDataUrl(file));
  };
  const submit = () => {
    if (choice === "print") props.onAssign({ type: "print" });
    else if (partner) props.onAssign({ type: "custom", label: `Logo ${partner.name}`, kind: "image", image: partner.image });
    else if (choice === "custom") { if (customLabel.trim()) props.onAssign({ type: "custom", label: customLabel.trim(), kind: customKind, ...(customKind === "image" && customImage ? { image: customImage } : {}) }); }
    else if (field) props.onAssign(isImage ? { type: "image", field: field.key } : { type: "field", field: field.key, mode: label ? mode : "replace" });
  };
  // Chọn cả vùng ô thường là khung ảnh → đưa nhóm Ảnh (và ảnh đối tác) lên đầu danh sách
  const allGroups = Object.keys(CATALOG_GROUP_LABELS) as CatalogField["group"][];
  const groups = multi ? ["image" as const, ...allGroups.filter((group) => group !== "image")] : allGroups;
  const partnerGroup = partnersWithImage.length > 0 && (
    <optgroup label="Logo / ảnh đối tác (logo thầu…)">
      {partnersWithImage.map((item) => <option key={item.id} value={`p:${item.id}`}>{item.name}</option>)}
    </optgroup>
  );

  return (
    <div className="cell-panel" role="dialog" aria-label={`Ô ${selection.range}`}>
      <div className="cell-panel-head">
        <b>Ô đang chọn: <code>{selection.range}</code></b>
        {label && <span className="muted cell-panel-text" title={label}>“{label}”</span>}
        <button type="button" className="button icon-button" aria-label="Bỏ chọn" onClick={props.onClose}><X size={14} aria-hidden="true" /></button>
      </div>
      {selection.regionIds.length > 0 && (
        <ul className="cell-panel-current">
          {selection.regionIds.map((id) => (
            <li key={id}><span>Đang điền: <b>{props.regionLabel(id)}</b></span><button type="button" className="button danger" disabled={props.busy} onClick={() => props.onRemove(id)}>Gỡ</button></li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>Điền vào {multi ? "vùng" : "ô"} này</span>
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="" disabled>Chọn dữ liệu…</option>
          {groups.map((group) => {
            const items = catalog.filter((item) => item.group === group);
            return (
              <Fragment key={group}>
                {items.length > 0 && <optgroup label={CATALOG_GROUP_LABELS[group]}>{items.map((item) => <option key={item.key} value={`f:${item.key}`}>{item.label}</option>)}</optgroup>}
                {group === "image" && partnerGroup}
              </Fragment>
            );
          })}
          <optgroup label="Khác">
            <option value="custom">＋ Ô nhập thêm mới: chữ, ngày, ô đánh dấu hoặc ảnh (logo, ảnh dự án…)</option>
            <option value="print">Đặt vùng này làm vùng in</option>
          </optgroup>
        </select>
      </label>
      {field && !isImage && label && (
        <div className="cell-panel-mode" role="radiogroup" aria-label="Cách ghi vào ô">
          <label><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> Giữ chữ “{label.length > 24 ? `${label.slice(0, 24)}…` : label}”, điền phía sau</label>
          <label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Thay cả ô bằng dữ liệu</label>
        </div>
      )}
      {(isImage || partner) && <p className="muted cell-panel-note">Ảnh sẽ lấp đầy đúng {multi ? "vùng ô" : "ô"} {selection.range}. Kéo chuột chọn cả khung ảnh nếu khung gồm nhiều ô.</p>}
      {partner && (
        <div className="fixed-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={partner.image} alt={`Ảnh ${partner.name}`} />
        </div>
      )}
      {field && !isImage && multi && <p className="muted cell-panel-note">Dữ liệu ghi vào ô đầu {selection.range.split(":")[0]} của vùng.</p>}
      {choice === "custom" && (
        <div className="cell-panel-custom">
          <label className="field"><span>Tên trường</span><input value={customLabel} placeholder={customKind === "image" ? "vd: Logo nhà thầu" : "vd: Ngày bắt đầu dự án"} onChange={(event) => setCustomLabel(event.target.value)} /></label>
          <label className="field"><span>Kiểu</span>
            <select value={customKind} onChange={(event) => setCustomKind(event.target.value as typeof customKind)}>
              <option value="text">Chữ</option><option value="date">Ngày</option><option value="checkbox">Ô đánh dấu ☑/☐</option><option value="image">Ảnh (logo, ảnh dự án…)</option>
            </select>
          </label>
        </div>
      )}
      {choice === "custom" && customKind === "image" && (
        <div className="fixed-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {customImage ? <img src={customImage} alt="Ảnh đã chọn" /> : <span className="muted">Chưa có ảnh</span>}
          <label className="button"><ImagePlus className="ico" size={14} aria-hidden="true" /> {customImage ? "Đổi ảnh" : "Tải ảnh lên"}<input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {partnersWithImage.length > 0 && (
            <select aria-label="Lấy ảnh đối tác" value={partnersWithImage.find((item) => item.image === customImage)?.id ?? ""}
              onChange={(event) => { const item = partnersWithImage.find((p) => p.id === event.target.value); if (item) { setImageError(""); setCustomImage(item.image); if (!customLabel.trim()) setCustomLabel(`Logo ${item.name}`); } }}>
              <option value="" disabled>Ảnh đối tác…</option>
              {partnersWithImage.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
        </div>
      )}
      {imageError && <p className="form-error">{imageError}</p>}
      <div className="cell-panel-actions">
        <button type="button" className="button primary" disabled={props.busy || !choice || (choice === "custom" && !customLabel.trim())} onClick={submit}>{props.busy ? "Đang ghi…" : "Gán"}</button>
      </div>
      {props.error && <p className="form-error" role="alert">{props.error}</p>}
    </div>
  );
}
