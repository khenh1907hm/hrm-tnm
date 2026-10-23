import { useMemo, useState } from "react";
import { Copy, Download, FileUp, Sparkles } from "lucide-react";
import { buildMappingRules, fieldRules, mergeAiTemplate, type AiTemplateMerge } from "../../modules/excel-template/engine/mappingPlan";
import { CATALOG_GROUP_LABELS, type CatalogField } from "../../modules/excel-template/engine/templateEdits";
import { base64ToUint8Array } from "../../modules/excel-template/templateStorage";

type Tab = "rules" | "prompt" | "import";

/**
 * Cài nhanh bằng AI (đóng sẵn, bấm mới mở): bảng quy tắc đặt tên biến, prompt gửi kèm file Excel, và nạp file Excel
 * AI trả về. Bảng và prompt dựng từ danh sách trường của app nên thêm biến mới là tự đồng bộ.
 */
export function TemplateAiSetup(props: { catalog: readonly CatalogField[]; fileBase64: string; sheetName: string; busy: boolean; onApply: (merge: AiTemplateMerge) => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("rules");
  const [merge, setMerge] = useState<(AiTemplateMerge & { fileName: string }) | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const rules = useMemo(() => fieldRules(props.catalog), [props.catalog]);
  const prompt = useMemo(() => buildMappingRules(props.catalog), [props.catalog]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "quy-tac-cai-mau-excel.md";
    link.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setMessage("Đã chép prompt, dán vào đoạn chat AI rồi gửi kèm file Excel mẫu trống."); }
    catch { setMessage("Trình duyệt chặn chép tự động, hãy bấm Tải về."); }
  };
  const read = async (file: File | undefined) => {
    if (!file) return;
    setMessage("");
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setMessage("Chọn file .xlsx AI trả về."); return; }
    setReading(true);
    try { setMerge({ ...(await mergeAiTemplate(base64ToUint8Array(props.fileBase64), new Uint8Array(await file.arrayBuffer()), props.sheetName, props.catalog)), fileName: file.name }); }
    catch { setMessage("Không đọc được file Excel này."); }
    finally { setReading(false); }
  };
  const apply = async () => {
    if (!merge) return;
    await props.onApply(merge);
    setMessage(`Đã ghi ${merge.cells.length} ô có mã và ${merge.images.length} vùng ảnh vào file mẫu. Xem lại trên ảnh phiếu, bấm vào ô để sửa nếu sai.`);
    setMerge(null);
  };
  const errors = merge?.problems.filter((problem) => problem.level === "error") ?? [];
  const warnings = merge?.problems.filter((problem) => problem.level === "warning") ?? [];
  const groups = Object.keys(CATALOG_GROUP_LABELS) as CatalogField["group"][];

  return (
    <details className="ai-setup">
      <summary><Sparkles className="ico" size={15} aria-hidden="true" /> Cài nhanh bằng AI <small>(quy tắc đặt tên biến, prompt, nạp file AI trả về)</small></summary>
      <div className="ai-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>1. Quy tắc đặt tên biến</button>
        <button type="button" role="tab" aria-selected={tab === "prompt"} onClick={() => setTab("prompt")}>2. Prompt cho AI</button>
        <button type="button" role="tab" aria-selected={tab === "import"} onClick={() => setTab("import")}>3. Nạp file AI trả về</button>
      </div>

      {tab === "rules" && (
        <div className="ai-tab-panel" role="tabpanel">
          <p className="muted">Gõ đúng mã trong ô Excel để app tự điền. Ảnh không gõ vào ô mà đặt <b>tên vùng</b> (Formulas → Define Name) cho cả khung ảnh. Thông tin chưa có trong bảng: tự đặt mã kiểu camelCase không dấu, vd “Số thẻ công trường” → <code>{"{{soTheCongTruong}}"}</code>. Bảng này lấy thẳng từ app, thêm trường mới là tự có ở đây.</p>
          <div className="table-scroll ai-rules">
            <table className="profile-table">
              <thead><tr><th>Ghi trong Excel</th><th>Ý nghĩa</th><th>Nhãn hay gặp trên phiếu</th></tr></thead>
              {groups.map((group) => {
                const rows = rules.filter((rule) => rule.group === group);
                return rows.length ? (
                  <tbody key={group}>
                    <tr className="ai-rules-group"><th colSpan={3}>{CATALOG_GROUP_LABELS[group]}</th></tr>
                    {rows.map((rule) => <tr key={rule.key}><td><code>{rule.write}</code></td><td>{rule.label}</td><td className="muted">{rule.aliases}</td></tr>)}
                  </tbody>
                ) : null;
              })}
            </table>
          </div>
        </div>
      )}

      {tab === "prompt" && (
        <div className="ai-tab-panel" role="tabpanel">
          <ol className="muted">
            <li>Chép prompt, dán vào một đoạn chat AI mới và gửi kèm <b>file Excel mẫu trống</b> (không gửi file có thông tin nhân viên).</li>
            <li>Trả lời các câu AI hỏi lại. AI trả về <b>file Excel đã gõ mã {"{{…}}"}</b>, tải file đó về.</li>
            <li>Sang thẻ 3 nạp file đó vào.</li>
          </ol>
          <div className="ai-setup-actions">
            <button type="button" className="button primary" onClick={() => void copy()}><Copy className="ico" size={14} aria-hidden="true" /> Chép prompt</button>
            <button type="button" className="button" onClick={download}><Download className="ico" size={14} aria-hidden="true" /> Tải về (.md)</button>
          </div>
          <pre className="ai-prompt">{prompt}</pre>
        </div>
      )}

      {tab === "import" && (
        <div className="ai-tab-panel" role="tabpanel">
          <p className="muted">App chỉ lấy các mã <code>{"{{…}}"}</code>, vùng <code>IMG_…</code> và vùng in trong file AI rồi ghi vào <b>file mẫu gốc</b>, nên logo, viền, màu của file gốc luôn giữ nguyên.</p>
          <label className="button ai-file"><FileUp className="ico" size={14} aria-hidden="true" /> {reading ? "Đang đọc…" : "Chọn file Excel AI trả về"}<input type="file" accept=".xlsx" hidden onChange={(event) => { void read(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {merge && (
            <div className="ai-merge">
              <p><b>{merge.fileName}</b>: {merge.cells.length} ô có mã, {merge.images.length} vùng ảnh{merge.printArea ? `, vùng in ${merge.printArea}` : ""}{merge.newKeys.length ? `, ${merge.newKeys.length} mã mới (thành ô nhập thêm): ${merge.newKeys.join(", ")}` : ""}.</p>
              <ul className="ai-setup-problems">
                {errors.map((problem, index) => <li key={`e${index}`} className="form-error">✗ {problem.message}</li>)}
                {warnings.map((problem, index) => <li key={`w${index}`} className="warn-text">! {problem.message}</li>)}
                {!merge.problems.length && <li className="ok-text">✓ Không có lỗi.</li>}
              </ul>
              <div className="ai-setup-actions">
                <button type="button" className="button primary" disabled={props.busy || (!merge.cells.length && !merge.images.length)} onClick={() => void apply()}>{props.busy ? "Đang ghi…" : "Áp dụng vào file mẫu"}</button>
                <button type="button" className="button" onClick={() => setMerge(null)}>Bỏ</button>
              </div>
            </div>
          )}
        </div>
      )}
      {message && <p className="ok-text" role="status">{message}</p>}
    </details>
  );
}
