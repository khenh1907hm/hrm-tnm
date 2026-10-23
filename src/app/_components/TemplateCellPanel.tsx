import { useState } from "react";
import { X } from "lucide-react";
import { CATALOG_GROUP_LABELS, type CatalogField, type PlacementMode } from "../../modules/excel-template/engine/templateEdits";
import type { PreviewSelection } from "./TemplatePreview";

/** Gán cho vùng ô đang chọn: một trường hồ sơ (ghi mã vào ô), một ảnh (lấp đầy vùng), một ô nhập thêm, hoặc làm vùng in. */
export type CellAssignment =
  | { type: "field"; field: string; mode: PlacementMode }
  | { type: "image"; field: string }
  | { type: "custom"; label: string; kind: "text" | "date" | "checkbox" | "image" }
  | { type: "print" };

/** Bảng nhỏ trên ảnh xem trước: ô đang chọn có gì, gỡ ra, hoặc chọn dữ liệu cần điền vào. */
export function TemplateCellPanel(props: {
  selection: PreviewSelection;
  catalog: readonly CatalogField[];
  regionLabel: (id: string) => string;
  busy: boolean;
  error: string;
  onAssign: (assignment: CellAssignment) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const { selection, catalog } = props;
  const [choice, setChoice] = useState("");
  const [mode, setMode] = useState<PlacementMode>("append");
  const [customLabel, setCustomLabel] = useState("");
  const [customKind, setCustomKind] = useState<"text" | "date" | "checkbox" | "image">(selection.range.includes(":") ? "image" : "text");
  // Chữ có sẵn trong ô (bỏ các mã đã gán) → hỏi thay cả ô hay điền sau chữ
  const label = selection.text.replace(/\{\{[^{}]*\}\}/g, "").trim();
  const field = choice.startsWith("f:") ? catalog.find((item) => item.key === choice.slice(2)) : undefined;
  const isImage = field?.kind === "image";
  const multi = selection.range.includes(":");

  const submit = () => {
    if (choice === "print") props.onAssign({ type: "print" });
    else if (choice === "custom") { if (customLabel.trim()) props.onAssign({ type: "custom", label: customLabel.trim(), kind: customKind }); }
    else if (field) props.onAssign(isImage ? { type: "image", field: field.key } : { type: "field", field: field.key, mode: label ? mode : "replace" });
  };
  // Chọn cả vùng ô thường là khung ảnh → đưa nhóm Ảnh lên đầu danh sách
  const allGroups = Object.keys(CATALOG_GROUP_LABELS) as CatalogField["group"][];
  const groups = multi ? ["image" as const, ...allGroups.filter((group) => group !== "image")] : allGroups;

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
            return items.length ? <optgroup key={group} label={CATALOG_GROUP_LABELS[group]}>{items.map((item) => <option key={item.key} value={`f:${item.key}`}>{item.label}</option>)}</optgroup> : null;
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
      {isImage && <p className="muted cell-panel-note">Ảnh sẽ lấp đầy đúng {multi ? "vùng ô" : "ô"} {selection.range}. Kéo chuột chọn cả khung ảnh nếu khung gồm nhiều ô.</p>}
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
      <div className="cell-panel-actions">
        <button type="button" className="button primary" disabled={props.busy || !choice || (choice === "custom" && !customLabel.trim())} onClick={submit}>{props.busy ? "Đang ghi…" : "Gán"}</button>
      </div>
      {props.error && <p className="form-error" role="alert">{props.error}</p>}
    </div>
  );
}
