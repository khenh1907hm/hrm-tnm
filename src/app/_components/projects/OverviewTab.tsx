"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { addDays } from "../../../lib/dates";
import { budgetSummary, formatPct, type BudgetLine } from "../../../modules/projects/budget";
import { projectDuration } from "../../../modules/projects/calendar";
import { formatHours, formatVnd } from "../../../modules/projects/cost";
import { cumulativeCost, flattenTimesheets } from "../../../modules/projects/reports";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABELS, type ProjectBudget } from "../../../modules/projects/types";
import type { TabProps } from "./ProjectDetail";
import { errorMessage, moneyInput, parseMoney } from "./projectShared";

const LEVEL_TEXT = { ok: "Trong ngân sách", warn: "Sắp chạm ngân sách", over: "Đã vượt ngân sách" } as const;

export function OverviewTab({ store, data, viewer, reload, setNotice }: TabProps) {
  const { project, today } = data;
  const [editing, setEditing] = useState(false);
  const duration = projectDuration(project, data.holidays, today);
  const rows = useMemo(() => flattenTimesheets(data.timesheets, data.costs), [data.timesheets, data.costs]);
  const approved = rows.filter((row) => row.status === "approved");
  const hours = { regular: approved.reduce((sum, row) => sum + row.regularHours, 0), ot: approved.reduce((sum, row) => sum + row.otHours, 0) };
  const planned = data.budgets.find((budget) => budget.category === "labor")?.plannedHours ?? null;
  const summary = budgetSummary({ budgets: data.budgets, costs: data.costs, expenses: data.expenses, subcontracts: data.subcontracts, payments: data.payments, today, remainingWorkdays: duration.remaining.working });
  const pendingSheets = data.timesheets.filter((sheet) => sheet.status === "submitted").length;

  return (
    <div className="pj-page">
      <div className="pj-kpis">
        {viewer.canSeeMoney && <>
          <Kpi label="Đã dùng / tổng ngân sách" value={formatPct(summary.total.pct)} hint={`${formatVnd(summary.total.used)} / ${formatVnd(summary.total.budget)}`} level={summary.total.level} />
          <Kpi label="Còn lại" value={formatVnd(summary.total.remaining)} hint={summary.total.pending ? `Chờ duyệt ${formatVnd(summary.total.pending)}` : "Không có khoản chờ duyệt"} level={summary.total.remaining < 0 ? "over" : "ok"} />
          <Kpi label="Dự báo khi kết thúc" value={formatVnd(summary.total.forecast)} hint={summary.total.forecastOver ? "Dự kiến vượt ngân sách" : "Dự kiến trong ngân sách"} level={summary.total.forecastOver ? "over" : "ok"} />
        </>}
        <Kpi label="Giờ công đã duyệt" value={`${formatHours(hours.regular + hours.ot)} giờ`} hint={`Thường ${formatHours(hours.regular)} · Tăng ca ${formatHours(hours.ot)}${planned ? ` · Kế hoạch ${formatHours(planned)}` : ""}`} level={planned && hours.regular + hours.ot > planned ? "warn" : "ok"} />
        <Kpi label="Ngày làm việc còn lại" value={String(duration.remaining.working)} hint={`Đến ${project.plannedEnd.split("-").reverse().join("/")}`} level={today > project.plannedEnd && project.status === "active" ? "over" : "ok"} />
        <Kpi label="Thành viên" value={String(data.members.filter((member) => member.leftOn === null || member.leftOn >= today).length)} hint={pendingSheets ? `${pendingSheets} phiếu công chờ duyệt` : "Không có phiếu chờ duyệt"} level={pendingSheets ? "warn" : "ok"} />
      </div>

      {viewer.canSeeMoney && (
        <section className="panel pj-section" aria-labelledby="pj-budget-title">
          <div className="pj-section-head">
            <h2 id="pj-budget-title">Ngân sách theo khoản</h2>
            {viewer.isPm && !editing && <button type="button" className="button" onClick={() => setEditing(true)}><Pencil className="ico" size={16} aria-hidden="true" /> Sửa ngân sách</button>}
          </div>
          {editing ? <BudgetForm budgets={data.budgets} onCancel={() => setEditing(false)} onSave={async (budgets, reason) => {
            try { await store.saveBudgets(project.id, budgets, reason); setEditing(false); setNotice("Đã lưu ngân sách.", "success"); await reload(); }
            catch (error) { setNotice(errorMessage(error), "error"); }
          }} /> : <BudgetTable lines={summary.lines} total={summary.total} />}
        </section>
      )}

      {viewer.canSeeMoney && <CostChart data={data} budget={summary.total.budget} forecast={summary.total.forecast} />}
    </div>
  );
}

function Kpi(props: { label: string; value: string; hint: string; level: "ok" | "warn" | "over" }) {
  return <div className={`pj-kpi ${props.level === "ok" ? "" : props.level}`}><span>{props.label}</span><b>{props.value}</b><small>{props.hint}</small></div>;
}

function BudgetTable({ lines, total }: { lines: BudgetLine[]; total: BudgetLine }) {
  return (
    <div className="table-scroll">
      <table className="pj-table">
        <thead><tr><th>Khoản</th><th className="pj-num">Ngân sách</th><th className="pj-num">Đã dùng</th><th className="pj-num">Chờ duyệt</th><th className="pj-num">Cam kết</th><th className="pj-num">Còn lại</th><th className="pj-num">Dự báo</th><th>Mức sử dụng</th></tr></thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.category}>
              <td>{BUDGET_CATEGORY_LABELS[line.category]}</td>
              <td className="pj-num">{formatVnd(line.budget)}</td>
              <td className="pj-num">{formatVnd(line.used)}</td>
              <td className="pj-num">{line.pending ? formatVnd(line.pending) : "—"}</td>
              <td className="pj-num">{line.committed ? formatVnd(line.committed) : "—"}</td>
              <td className="pj-num">{formatVnd(line.remaining)}</td>
              <td className="pj-num">{formatVnd(line.forecast)}{line.forecastOver && <AlertTriangle className="ico" size={14} aria-label="Dự kiến vượt" style={{ color: "var(--bad)", marginLeft: 4 }} />}</td>
              <td style={{ minWidth: 160 }}>
                <div className={`pj-bar ${line.level}`}><span style={{ width: `${Math.min(100, Number.isFinite(line.pct) ? line.pct * 100 : 100)}%` }} /></div>
                <small className={line.level === "over" ? "warn-text" : "muted"}>{formatPct(line.pct)} · {LEVEL_TEXT[line.level]}</small>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Tổng</td><td className="pj-num">{formatVnd(total.budget)}</td><td className="pj-num">{formatVnd(total.used)}</td><td className="pj-num">{formatVnd(total.pending)}</td><td className="pj-num">{formatVnd(total.committed)}</td><td className="pj-num">{formatVnd(total.remaining)}</td><td className="pj-num">{formatVnd(total.forecast)}</td><td>{formatPct(total.pct)}</td></tr></tfoot>
      </table>
    </div>
  );
}

function BudgetForm(props: { budgets: ProjectBudget[]; onCancel: () => void; onSave: (budgets: ProjectBudget[], reason: string) => Promise<void> }) {
  const [draft, setDraft] = useState<ProjectBudget[]>(() => BUDGET_CATEGORIES.map((category) => props.budgets.find((item) => item.category === category) ?? { category, amount: 0, warnPct: 80, plannedHours: null }));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (index: number, patch: Partial<ProjectBudget>) => setDraft((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  return (
    <div className="pj-page">
      <div className="table-scroll">
        <table className="pj-table">
          <thead><tr><th>Khoản</th><th>Ngân sách (VNĐ)</th><th>Ngưỡng cảnh báo (%)</th><th>Giờ công kế hoạch</th></tr></thead>
          <tbody>
            {draft.map((item, index) => (
              <tr key={item.category}>
                <td>{BUDGET_CATEGORY_LABELS[item.category]}</td>
                <td><input inputMode="numeric" aria-label={`Ngân sách ${BUDGET_CATEGORY_LABELS[item.category]}`} value={moneyInput(item.amount)} onChange={(event) => update(index, { amount: parseMoney(event.target.value) })} /></td>
                <td><input type="number" min={1} max={100} aria-label="Ngưỡng cảnh báo" value={item.warnPct} onChange={(event) => update(index, { warnPct: Math.min(100, Math.max(1, Number(event.target.value) || 80)) })} /></td>
                <td>{item.category === "labor" ? <input type="number" min={0} step={1} aria-label="Giờ công kế hoạch" value={item.plannedHours ?? ""} onChange={(event) => update(index, { plannedHours: event.target.value === "" ? null : Number(event.target.value) })} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="field"><span>Lý do điều chỉnh (ghi vào lịch sử)</span><input value={reason} placeholder="vd: Bổ sung theo phụ lục hợp đồng số 2" onChange={(event) => setReason(event.target.value)} /></label>
      <div className="button-row"><button type="button" className="button" onClick={props.onCancel}>Hủy</button><button type="button" className="button primary" disabled={busy} onClick={() => { setBusy(true); void props.onSave(draft, reason.trim()).finally(() => setBusy(false)); }}>Lưu ngân sách</button></div>
    </div>
  );
}

/** Biểu đồ chi phí lũy kế, đường ngân sách và đường dự báo (SVG thuần, không thêm thư viện). */
function CostChart({ data, budget, forecast }: { data: TabProps["data"]; budget: number; forecast: number }) {
  const { project, today } = data;
  const from = project.actualStart ?? project.plannedStart;
  const end = project.plannedEnd > today ? project.plannedEnd : today;
  const series = cumulativeCost(data.costs, data.expenses, data.payments, from, today < from ? from : today);
  const totalDays = Math.max(1, Math.round((Date.parse(end) - Date.parse(from)) / 86_400_000));
  const top = Math.max(budget, forecast, series.at(-1)?.total ?? 0, 1) * 1.08;
  const width = 640, height = 200, left = 8, bottom = 22;
  const x = (date: string) => left + (Math.round((Date.parse(date) - Date.parse(from)) / 86_400_000) / totalDays) * (width - left * 2);
  const y = (value: number) => (height - bottom) * (1 - value / top) + 4;
  const path = series.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)},${y(point.total).toFixed(1)}`).join(" ");
  const last = series.at(-1);
  return (
    <section className="panel pj-section" aria-labelledby="pj-chart-title">
      <h2 id="pj-chart-title">Chi phí lũy kế</h2>
      <svg className="pj-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Chi phí lũy kế ${formatVnd(last?.total ?? 0)}, ngân sách ${formatVnd(budget)}, dự báo ${formatVnd(forecast)}`} preserveAspectRatio="none">
        <line className="axis" x1={left} x2={width - left} y1={height - bottom + 4} y2={height - bottom + 4} />
        {budget > 0 && <line className="budget" x1={left} x2={width - left} y1={y(budget)} y2={y(budget)} />}
        {path && <path className="used" d={path} />}
        {last && today < end && <line className="forecast" x1={x(last.date)} y1={y(last.total)} x2={x(end)} y2={y(forecast)} />}
        <text x={left} y={height - 4}>{from.split("-").reverse().join("/")}</text>
        <text x={width - left} y={height - 4} textAnchor="end">{end.split("-").reverse().join("/")}</text>
        {today > from && today < end && <text x={x(today)} y={height - 4} textAnchor="middle">Hôm nay</text>}
      </svg>
      <div className="pj-legend"><span><i />Đã dùng {formatVnd(last?.total ?? 0)}</span><span><i className="budget" />Ngân sách {formatVnd(budget)}</span><span><i className="forecast" />Dự báo {formatVnd(forecast)}</span></div>
      <small className="muted">Dự báo = đã dùng + phần còn lại của hợp đồng khoán + chi phí công trung bình 14 ngày gần nhất × số ngày làm việc còn lại (từ {addDays(today, 1).split("-").reverse().join("/")}).</small>
    </section>
  );
}
