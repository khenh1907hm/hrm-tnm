import { useState } from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import type { EmployeeImportOutcome } from "../../app-core/use-cases/employees";
import type { Actor } from "../../modules/auth/permissions";
import { IMPORT_FIELD_LABELS, parseSheet, type ParsedSheet } from "../../modules/employee-import/parse";
import { buildErrorReport, buildImportTemplate, readWorkbook, type SheetRows } from "../../modules/employee-import/workbook";
import { downloadXlsx } from "./profileExport";
import { issueText, type App, type SetNotice } from "./shared";

/** Mỗi lượt lưu bao nhiêu dòng: đủ nhỏ để thanh tiến độ chạy đều, đủ lớn để ít lần đọc lại danh sách. */
const SAVE_BATCH = 25;

type RowResult = { rowNumber: number; cells: string[]; code: string; name: string; ok: boolean; messages: string[] };
type Stage =
  | { kind: "pick" }
  | { kind: "checking" }
  | { kind: "preview"; sheet: ParsedSheet; results: RowResult[] }
  | { kind: "saving"; done: number; total: number }
  | { kind: "finished"; sheet: ParsedSheet; imported: number; failures: RowResult[] };

const outcomeMessages = (outcome: EmployeeImportOutcome) => [
  ...(outcome.ok ? [] : outcome.errors.map((item) => issueText(item.code))),
  ...outcome.warnings.map((item) => `Lưu ý: ${issueText(item.code)}`),
];

export function ImportEmployeesModal(props: { app: App; actor: Actor; setNotice: SetNotice; onClose: () => void; onImported: () => void }) {
  const { app, actor, setNotice } = props;
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [sheets, setSheets] = useState<SheetRows[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [fileName, setFileName] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [problem, setProblem] = useState("");

  /** Đọc trang tính, rồi cho hệ thống kiểm tra thử (không lưu) để biết trước dòng nào lỗi. */
  const check = async (rows: SheetRows) => {
    setProblem("");
    const sheet = parseSheet(rows.rows);
    if (!sheet) { setStage({ kind: "pick" }); setProblem(`Trang “${rows.name}” không có dòng tiêu đề nhận ra được (ví dụ “Mã NV”, “Họ và tên”, “Ngày sinh”). Dùng file mẫu để biết tên cột.`); return; }
    if (!sheet.rows.length) { setStage({ kind: "pick" }); setProblem(`Trang “${rows.name}” chưa có dòng dữ liệu nào dưới tiêu đề.`); return; }
    setStage({ kind: "checking" });
    const ready = sheet.rows.filter((row) => row.input);
    const checked = ready.length ? await app.employees.importMany(actor, { rows: ready.map((row) => row.input!), dryRun: true }) : null;
    if (checked && !checked.ok) { setStage({ kind: "pick" }); setProblem(issueText(checked.errors[0]?.code ?? "FORBIDDEN")); return; }
    const outcomes = new Map(ready.map((row, index) => [row.rowNumber, checked!.value[index]!]));
    const results = sheet.rows.map((row): RowResult => {
      const outcome = outcomes.get(row.rowNumber);
      const messages = [...row.errors, ...(outcome ? outcomeMessages(outcome) : []), ...row.notes];
      return { rowNumber: row.rowNumber, cells: row.cells, code: row.input?.code ?? row.cells[sheet.columns.code ?? -1] ?? "", name: row.input?.name ?? row.cells[sheet.columns.name ?? -1] ?? "", ok: Boolean(outcome?.ok), messages };
    });
    setStage({ kind: "preview", sheet, results });
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    setFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) { setProblem("Chỉ nhận file .xlsx. File .xls hoặc .xlsm cũ: mở bằng Excel rồi Lưu thành (Save As) dạng .xlsx."); return; }
    try {
      const found = await readWorkbook(await file.arrayBuffer());
      if (!found.length) { setProblem("File không có trang tính nào chứa dữ liệu."); return; }
      // Ưu tiên trang đầu tiên nhận ra được tiêu đề
      const first = Math.max(0, found.findIndex((item) => parseSheet(item.rows)));
      setSheets(found);
      setSheetIndex(first);
      await check(found[first]!);
    } catch {
      setStage({ kind: "pick" });
      setProblem("Không đọc được file. Kiểm tra file có mở được bằng Excel không.");
    }
  };

  const save = async (sheet: ParsedSheet, results: RowResult[]) => {
    const valid = sheet.rows.filter((row) => row.input && results.find((result) => result.rowNumber === row.rowNumber)?.ok);
    const failures = results.filter((result) => !result.ok);
    let imported = 0;
    setStage({ kind: "saving", done: 0, total: valid.length });
    for (let start = 0; start < valid.length; start += SAVE_BATCH) {
      const batch = valid.slice(start, start + SAVE_BATCH);
      const saved = await app.employees.importMany(actor, { rows: batch.map((row) => row.input!), dryRun: false });
      batch.forEach((row, index) => {
        const outcome = saved.ok ? saved.value[index] : undefined;
        if (outcome?.ok) imported += 1;
        else failures.push({ ...results.find((result) => result.rowNumber === row.rowNumber)!, ok: false, messages: outcome ? outcomeMessages(outcome) : [issueText("EMP_IMPORT_SAVE_FAILED")] });
      });
      setStage({ kind: "saving", done: Math.min(start + SAVE_BATCH, valid.length), total: valid.length });
    }
    failures.sort((a, b) => a.rowNumber - b.rowNumber);
    setStage({ kind: "finished", sheet, imported, failures });
    if (imported) { setNotice(`Đã nhập ${imported} hồ sơ nhân sự.`, "success"); props.onImported(); }
  };

  const downloadFailures = async (sheet: ParsedSheet, failures: RowResult[]) => {
    const bytes = await buildErrorReport(sheet.headers, failures);
    downloadXlsx(bytes, `DongLoi_${fileName.replace(/\.xlsx$/i, "") || "nhap-nhan-su"}.xlsx`);
  };

  const downloadTemplate = async () => downloadXlsx(await buildImportTemplate(), "mau-nhap-nhan-su.xlsx");

  const busy = stage.kind === "checking" || stage.kind === "saving";
  const close = () => { if (!busy) props.onClose(); };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <section className="modal-card import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header><h2 id="import-title">Nhập nhân sự từ Excel</h2><button type="button" className="close" onClick={close} disabled={busy} aria-label="Đóng">×</button></header>
        <div className="import-body">
          {(stage.kind === "pick" || stage.kind === "preview" || stage.kind === "checking") && (
            <div className="import-pick">
              <label className="button primary">
                <FileSpreadsheet className="ico" size={16} aria-hidden="true" /> {fileName ? "Chọn file khác" : "Chọn file .xlsx"}
                <input type="file" accept=".xlsx" hidden disabled={busy} onChange={(event) => { void pickFile(event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              {fileName && <span className="muted">{fileName}</span>}
              {sheets.length > 1 && (
                <label className="import-sheet">Trang tính
                  <select value={sheetIndex} disabled={busy} onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); void check(sheets[index]!); }}>
                    {sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
                  </select>
                </label>
              )}
              <button type="button" className="button ghost" onClick={() => void downloadTemplate()}><FileDown className="ico" size={16} aria-hidden="true" /> Tải file mẫu</button>
            </div>
          )}
          {stage.kind === "pick" && !problem && <p className="muted">Hệ thống tự nhận tên cột (ví dụ “Mã NV”, “SĐT”, “Quê quán”, “Chức vụ”) và cho xem trước từng dòng trước khi lưu. Dòng lỗi không được nhập; tải danh sách dòng lỗi về để sửa rồi nhập lại.</p>}
          {problem && <p className="form-error" role="alert">{problem}</p>}
          {stage.kind === "checking" && <p className="muted" role="status">Đang kiểm tra dữ liệu…</p>}

          {stage.kind === "preview" && (() => {
            const { sheet, results } = stage;
            const okCount = results.filter((row) => row.ok).length;
            const shown = onlyErrors ? results.filter((row) => !row.ok) : results;
            return <>
              {sheet.missing.length > 0 && <p className="form-error" role="alert">File thiếu cột bắt buộc: {sheet.missing.map((field) => IMPORT_FIELD_LABELS[field]).join(", ")}. Thêm cột (đặt tên như file mẫu) rồi chọn lại file.</p>}
              <div className="import-summary">
                <span>Tiêu đề ở dòng {sheet.headerRow}</span>
                <span className="pill ok">{okCount} dòng hợp lệ</span>
                <span className={okCount === results.length ? "pill" : "pill bad"}>{results.length - okCount} dòng lỗi</span>
                <label className="check-field"><input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} /> Chỉ hiện dòng lỗi</label>
              </div>
              <div className="panel table-scroll import-table">
                <table>
                  <thead><tr><th>Dòng</th><th>Mã NV</th><th>Họ và tên</th><th>Kết quả</th></tr></thead>
                  <tbody>{shown.map((row) => (
                    <tr key={row.rowNumber} className={row.ok ? undefined : "import-error"}>
                      <td>{row.rowNumber}</td><td>{row.code}</td><td>{row.name}</td>
                      <td>{row.ok ? <span className="pill ok">Hợp lệ</span> : <span className="pill bad">Lỗi</span>}{row.messages.length > 0 && <ul>{row.messages.map((message) => <li key={message}>{message}</li>)}</ul>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>;
          })()}

          {stage.kind === "saving" && (
            <div className="import-progress" role="status">
              <p>Đang lưu {stage.done}/{stage.total} hồ sơ… Đừng đóng trang.</p>
              <progress value={stage.done} max={stage.total || 1} />
            </div>
          )}

          {stage.kind === "finished" && (
            <div className="import-finished" role="status">
              <p><b>Đã nhập {stage.imported} hồ sơ.</b>{stage.failures.length > 0 && ` ${stage.failures.length} dòng chưa nhập được.`}</p>
              {stage.failures.length > 0 && <p className="muted">Tải danh sách dòng lỗi về, sửa ngay trong file đó (cột “Lỗi cần sửa” ghi lý do) rồi nhập lại. File chỉ gồm các dòng chưa nhập nên không bị nhập trùng.</p>}
            </div>
          )}
        </div>
        <footer>
          {stage.kind === "preview" && stage.results.some((row) => !row.ok) && <button type="button" className="button" onClick={() => void downloadFailures(stage.sheet, stage.results.filter((row) => !row.ok))}><FileDown className="ico" size={16} aria-hidden="true" /> Tải dòng lỗi</button>}
          {stage.kind === "finished" && stage.failures.length > 0 && <button type="button" className="button" onClick={() => void downloadFailures(stage.sheet, stage.failures)}><FileDown className="ico" size={16} aria-hidden="true" /> Tải dòng lỗi</button>}
          <button type="button" className="button" onClick={close} disabled={busy}>{stage.kind === "finished" ? "Xong" : "Đóng"}</button>
          {stage.kind === "preview" && (() => {
            const count = stage.results.filter((row) => row.ok).length;
            return <button type="button" className="button primary" disabled={!count || stage.sheet.missing.length > 0} onClick={() => void save(stage.sheet, stage.results)}>Nhập {count} hồ sơ hợp lệ</button>;
          })()}
        </footer>
      </section>
    </div>
  );
}
