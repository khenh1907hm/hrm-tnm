import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { buildMappingRules, parseMappingPlan, type MappingPlan, type MappingProblem } from "../../modules/excel-template/engine/mappingPlan";
import type { CatalogField } from "../../modules/excel-template/engine/templateEdits";

/** Cài nhanh bằng AI: tải bộ quy tắc + prompt gửi kèm file Excel trong đoạn chat, rồi dán kết quả AI trả về để app tự gán ô. */
export function TemplateAiSetup(props: { catalog: readonly CatalogField[]; sheetName: string; busy: boolean; onApply: (plan: MappingPlan) => Promise<void> }) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<{ plan: MappingPlan | null; problems: MappingProblem[] } | null>(null);
  const [done, setDone] = useState("");

  const download = () => {
    const blob = new Blob([buildMappingRules(props.catalog)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quy-tac-cai-mau-excel.md";
    link.click();
    URL.revokeObjectURL(url);
  };
  const check = () => {
    const result = parseMappingPlan(text, props.catalog);
    if (result.plan?.sheet && result.plan.sheet !== props.sheetName) result.problems.push({ level: "warning", message: `AI ghi sheet "${result.plan.sheet}", app đang dùng sheet "${props.sheetName}". Kiểm tra lại các ô trên ảnh.` });
    setChecked(result);
    setDone("");
  };
  const apply = async () => {
    if (!checked?.plan) return;
    await props.onApply(checked.plan);
    const { fields, images, customFields } = checked.plan;
    setDone(`Đã gán ${fields.length} ô dữ liệu, ${images.length} vùng ảnh, ${customFields.length} ô nhập thêm. Xem lại trên ảnh phiếu, bấm vào ô để sửa nếu sai.`);
    setChecked(null);
    setText("");
  };
  const errors = checked?.problems.filter((problem) => problem.level === "error") ?? [];
  const warnings = checked?.problems.filter((problem) => problem.level === "warning") ?? [];
  const total = checked?.plan ? checked.plan.fields.length + checked.plan.images.length + checked.plan.customFields.length + (checked.plan.printArea ? 1 : 0) : 0;

  return (
    <section className="ai-setup">
      <h3><Sparkles className="ico" size={15} aria-hidden="true" /> Cài nhanh bằng AI <small>(tùy chọn)</small></h3>
      <ol className="muted">
        <li>Tải bộ quy tắc, dán vào đoạn chat AI mới, gửi kèm <b>file Excel mẫu trống</b> (không gửi file có thông tin nhân viên).</li>
        <li>Trả lời các câu AI hỏi lại, rồi chép khối JSON AI trả về dán vào ô dưới.</li>
        <li>Bấm Kiểm tra → Áp dụng. Các ô sáng lên trên ảnh phiếu; ô nào sai thì bấm vào ô đó để sửa.</li>
      </ol>
      <button type="button" className="button" onClick={download}><Download className="ico" size={14} aria-hidden="true" /> Tải bộ quy tắc + prompt</button>
      <label className="field">
        <span>Kết quả AI trả về</span>
        <textarea rows={5} value={text} placeholder='{ "printArea": "B1:AZ73", "fields": [ { "cell": "E9", "field": "fullNameUpper" } ], … }' onChange={(event) => { setText(event.target.value); setChecked(null); }} />
      </label>
      <div className="ai-setup-actions">
        <button type="button" className="button" disabled={!text.trim()} onClick={check}>Kiểm tra</button>
        {checked?.plan && total > 0 && <button type="button" className="button primary" disabled={props.busy} onClick={() => void apply()}>{props.busy ? "Đang ghi…" : `Áp dụng ${total} mục${errors.length ? " hợp lệ" : ""}`}</button>}
      </div>
      {checked && (
        <ul className="ai-setup-problems">
          {errors.map((problem, index) => <li key={`e${index}`} className="form-error">✗ {problem.message}</li>)}
          {warnings.map((problem, index) => <li key={`w${index}`} className="warn-text">! {problem.message}</li>)}
          {!checked.problems.length && <li className="ok-text">✓ Không có lỗi, {total} mục sẵn sàng áp dụng.</li>}
        </ul>
      )}
      {done && <p className="ok-text" role="status">{done}</p>}
    </section>
  );
}
