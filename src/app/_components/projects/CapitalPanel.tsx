"use client";
import { useState } from "react";
import { Landmark, Pencil } from "lucide-react";
import { formatPct } from "../../../modules/projects/budget";
import { costsByPeriod, periodLabel, type Granularity } from "../../../modules/projects/capital";
import { formatVnd } from "../../../modules/projects/cost";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

/**
 * Vốn dự án (PRJ-16): nhập vốn, xem đã chi và vốn còn lại; chi phí đã duyệt theo ngày / tháng / năm trừ dần vào vốn.
 * Chỉ Admin, PM và Chỉ huy trưởng thấy (RLS bảng project_finance và các bảng tiền).
 */
export function CapitalPanel({ store, data, reload, setNotice }: Pick<TabProps, "store" | "data" | "reload" | "setNotice">) {
  const capital = data.finance?.capital ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ capital, note: data.finance?.note ?? "" });
  const [granularity, setGranularity] = useState<Granularity>("month");
  const rows = costsByPeriod({ capital, costs: data.costs, expenses: data.expenses, payments: data.payments, granularity });
  const spent = rows.at(-1)?.cumulative ?? 0;
  const left = capital - spent;
  const pct = capital > 0 ? spent / capital : spent > 0 ? Infinity : 0;
  const level = !capital ? "" : pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "";
  const shown = granularity === "day" ? rows.slice(-31) : rows;

  const save = async () => {
    try { await store.saveFinance(data.project.id, { capital: draft.capital, note: draft.note.trim() }); setEditing(false); setNotice("Đã lưu vốn dự án.", "success"); await reload(); }
    catch (error) { setNotice(errorMessage(error), "error"); }
  };

  return (
    <section className="panel pj-section" aria-labelledby="pj-capital-title">
      <div className="pj-section-head">
        <h2 id="pj-capital-title"><Landmark className="ico" size={18} aria-hidden="true" /> Vốn dự án</h2>
        {!editing && <button type="button" className="button" onClick={() => { setDraft({ capital, note: data.finance?.note ?? "" }); setEditing(true); }}><Pencil className="ico" size={16} aria-hidden="true" /> {capital ? "Sửa vốn" : "Nhập vốn"}</button>}
      </div>
      {editing ? (
        <div className="form-grid" style={{ padding: 0 }}>
          <label className="field"><span>Vốn dự án (VNĐ)</span><input inputMode="numeric" autoFocus value={moneyInput(draft.capital)} onChange={(event) => setDraft({ ...draft, capital: parseMoney(event.target.value) })} /></label>
          <label className="field"><span>Ghi chú</span><input value={draft.note} placeholder="vd: Theo hợp đồng số 12/2026" onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
          <div className="button-row" style={{ gridColumn: "1 / -1" }}><button type="button" className="button" onClick={() => setEditing(false)}>Hủy</button><button type="button" className="button primary" onClick={() => void save()}>Lưu vốn</button></div>
        </div>
      ) : (
        <>
          <div className="pj-kpis">
            <div className="pj-kpi"><span>Vốn dự án</span><b>{capital ? formatVnd(capital) : "Chưa nhập"}</b><small>{data.finance?.note || "Nhập vốn để theo dõi vốn còn lại"}</small></div>
            <div className={`pj-kpi ${level}`}><span>Đã chi (đã duyệt)</span><b>{formatVnd(spent)}</b><small>{capital ? `${formatPct(pct)} vốn` : "—"}</small></div>
            <div className={`pj-kpi ${capital && left < 0 ? "over" : level}`}><span>Vốn còn lại</span><b>{capital ? formatVnd(left) : "—"}</b><small>{!capital ? "Chưa nhập vốn" : left < 0 ? "Đã vượt vốn" : "Sau khi trừ mọi chi phí đã duyệt"}</small></div>
          </div>
          {capital > 0 && <div className={`pj-bar ${level}`} role="img" aria-label={`Đã dùng ${formatPct(pct)} vốn`}><span style={{ width: `${Math.min(100, Number.isFinite(pct) ? pct * 100 : 100)}%` }} /></div>}
        </>
      )}

      <div className="pj-section-head">
        <h3 style={{ margin: 0, fontSize: 15 }}>Chi phí trừ vào vốn</h3>
        <div className="role-switch" role="group" aria-label="Xem theo">
          {([["day", "Ngày"], ["month", "Tháng"], ["year", "Năm"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={granularity === key} onClick={() => setGranularity(key)}>{label}</button>)}
        </div>
      </div>
      {!rows.length ? <p className="muted">Chưa có chi phí nào được duyệt. Tiền công chỉ trừ vào vốn khi chỉ huy trưởng duyệt phiếu công.</p> : (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>{granularity === "day" ? "Ngày" : granularity === "month" ? "Tháng" : "Năm"}</th><th className="pj-num">Nhân công</th><th className="pj-num">Thầu phụ</th><th className="pj-num">Vật tư</th><th className="pj-num">Khác</th><th className="pj-num">Tổng kỳ</th><th className="pj-num">Lũy kế</th><th className="pj-num">Vốn còn lại</th></tr></thead>
            <tbody>{[...shown].reverse().map((row) => (
              <tr key={row.period}>
                <td>{periodLabel(row.period)}</td>
                <td className="pj-num">{row.labor ? formatVnd(row.labor) : "—"}</td>
                <td className="pj-num">{row.subcontract ? formatVnd(row.subcontract) : "—"}</td>
                <td className="pj-num">{row.material ? formatVnd(row.material) : "—"}</td>
                <td className="pj-num">{row.other ? formatVnd(row.other) : "—"}</td>
                <td className="pj-num"><b>{formatVnd(row.total)}</b></td>
                <td className="pj-num">{formatVnd(row.cumulative)}</td>
                <td className={`pj-num ${row.capitalLeft < 0 ? "warn-text" : ""}`}>{capital ? formatVnd(row.capitalLeft) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {granularity === "day" && rows.length > 31 && <small className="muted">Đang hiện 31 ngày gần nhất có chi phí. Xem theo Tháng hoặc Năm để thấy toàn bộ.</small>}
    </section>
  );
}
