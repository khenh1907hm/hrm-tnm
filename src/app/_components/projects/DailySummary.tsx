"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { weekdayShort } from "../../../modules/projects/calendar";
import type { DailyReport } from "../../../modules/projects/dailyReport";
import { periodRange, periodTitle, shiftPeriod, summarizeDailyReports, type PeriodKind } from "../../../modules/projects/dailyReportSummary";
import { buildDailySummaryWorkbook } from "../../../modules/projects/dailySummaryWorkbook";
import { downloadXlsx } from "../profileExport";
import type { TabProps } from "./ProjectDetail";
import { errorMessage } from "./projectShared";

const dmy = (iso: string) => iso.split("-").reverse().join("/");
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Báo cáo tuần / tháng: tổng hợp các BC ngày trong kỳ, xem trên web và xuất Excel. */
export function DailySummary({ store, data, viewer, setNotice, refreshKey }: Pick<TabProps, "store" | "data" | "viewer" | "setNotice"> & { refreshKey: number }) {
  const { project, today, holidays } = data;
  const [kind, setKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState(today);
  const range = useMemo(() => periodRange(kind, anchor), [kind, anchor]);
  const [loaded, setLoaded] = useState<{ key: string; reports: DailyReport[] } | null>(null);
  const key = `${range.from}|${range.to}|${refreshKey}`;

  useEffect(() => {
    let active = true;
    void store.listDailyReports(project.id, range).then(
      (reports) => { if (active) setLoaded({ key, reports }); },
      (error: unknown) => { if (active) { setLoaded({ key, reports: [] }); setNotice(errorMessage(error), "error"); } },
    );
    return () => { active = false; };
  }, [store, project.id, range, key, setNotice]);

  const reports = loaded?.key === key ? loaded.reports : null;
  const summary = useMemo(() => reports ? summarizeDailyReports(reports, range, { weeklyOff: project.weeklyOff, holidays, stdHours: project.stdHours, today, startDate: project.actualStart ?? project.plannedStart }) : null, [reports, range, project.weeklyOff, project.stdHours, project.actualStart, project.plannedStart, holidays, today]);
  const isCurrent = range.from <= today && today <= range.to;

  const exportExcel = async () => {
    if (!summary) return;
    try {
      const bytes = await buildDailySummaryWorkbook({ project, kind, summary, exportedBy: viewer.isAdmin ? "Admin" : "PM / CHT", exportedOn: today });
      downloadXlsx(bytes, `BC-${kind === "week" ? "tuan" : "thang"}-${project.code.replace(/[^\w.-]+/g, "-")}-${range.from}.xlsx`);
      setNotice(`Đã xuất ${periodTitle(kind, range).toLowerCase()}.`, "success");
    } catch (error) { setNotice(errorMessage(error), "error"); }
  };

  return (
    <section className="panel pj-section dr-summary" aria-labelledby="dr-summary-title">
      <div className="pj-section-head">
        <h2 id="dr-summary-title"><BarChart3 className="ico" size={18} aria-hidden="true" /> Báo cáo tuần / tháng</h2>
      </div>
      <div className="role-switch dr-mode" role="group" aria-label="Loại báo cáo">
        {(["week", "month"] as const).map((item) => <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)}>{item === "week" ? "Tuần" : "Tháng"}</button>)}
      </div>
      <div className="dr-period">
        <button type="button" className="button icon-button" aria-label="Kỳ trước" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <label className="dr-period-label">
          <b>{periodTitle(kind, range)}</b>
          {kind === "month"
            ? <input type="month" aria-label="Chọn tháng" value={anchor.slice(0, 7)} onChange={(event) => event.target.value && setAnchor(`${event.target.value}-01`)} />
            : <input type="date" aria-label="Chọn ngày trong tuần" value={anchor} onChange={(event) => event.target.value && setAnchor(event.target.value)} />}
        </label>
        <button type="button" className="button icon-button" aria-label="Kỳ sau" onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      {!isCurrent && <button type="button" className="button dr-today" onClick={() => setAnchor(today)}>Về {kind === "week" ? "tuần" : "tháng"} này</button>}

      {!summary ? <div className="loading">Đang tổng hợp…</div> : (
        <>
          <div className="dr-kpis">
            <div><span>Ngày có báo cáo</span><b>{summary.reportedDays}<small>/{summary.days.length}</small></b></div>
            <div><span>Tổng công</span><b>{summary.workdays}</b></div>
            <div><span>Giờ công</span><b>{summary.regularHours}</b><small>{project.stdHours} giờ/công</small></div>
            <div><span>Tăng ca</span><b>{summary.otHours} giờ</b><small>{summary.otPersonDays} lượt người</small></div>
            <div><span>Hiện diện TB</span><b>{summary.avgPresent}</b><small>cao nhất {summary.maxPresent}</small></div>
            <div className={summary.missingDates.length ? "warn" : ""}><span>Thiếu báo cáo</span><b>{summary.missingDates.length}</b><small>{summary.missingDates.length ? summary.missingDates.map(dm).join(", ") : "Đủ"}</small></div>
          </div>

          <div className="table-scroll">
            <table className="pj-table dr-summary-table">
              <thead><tr><th>Ngày</th><th className="pj-num">TS</th><th className="pj-num">HD</th><th className="pj-num">V</th><th className="pj-num">TC</th><th className="dr-col-tasks">Công việc</th></tr></thead>
              <tbody>{summary.days.map((day) => (
                <tr key={day.date} className={day.missing ? "dr-missing" : day.kind !== "workday" ? "dr-off" : ""}>
                  <td><b>{dm(day.date)}</b> <small className="muted">{weekdayShort(day.date)}</small></td>
                  {day.report ? <>
                    <td className="pj-num">{day.report.total ?? "–"}</td>
                    <td className="pj-num"><b>{day.report.present ?? "–"}</b></td>
                    <td className="pj-num">{day.report.absent ?? "–"}</td>
                    <td className="pj-num">{day.report.otHours ? `${day.report.otCount}/${day.report.otHours}g` : "–"}</td>
                    <td className="dr-col-tasks">{day.report.tasks.map((task) => task.task).join(" · ")}</td>
                  </> : <td colSpan={5} className="muted">{day.missing ? "Chưa có báo cáo" : day.kind === "holiday" ? "Ngày lễ" : day.kind === "weekly_off" ? "Nghỉ tuần" : ""}</td>}
                </tr>
              ))}</tbody>
              <tfoot><tr><td><b>Tổng</b></td><td /><td className="pj-num"><b>{summary.workdays}</b></td><td className="pj-num">{summary.absentDays}</td><td className="pj-num">{summary.otPersonDays}/{summary.otHours}g</td><td className="dr-col-tasks muted">{summary.reportedDays} ngày có báo cáo</td></tr></tfoot>
            </table>
          </div>

          {summary.tasks.length > 0 && (
            <details className="dr-task-summary">
              <summary>Theo công việc ({summary.tasks.length})</summary>
              <ul>{summary.tasks.map((task) => <li key={task.task}><span>{task.task}{task.leaders.length ? <small className="muted"> · {task.leaders.join(", ")}</small> : null}</span><b>{task.days} ngày · {task.personDays} công</b></li>)}</ul>
            </details>
          )}

          <button type="button" className="button primary dr-wide" disabled={!summary.reportedDays} onClick={() => void exportExcel()}><Download className="ico" size={16} aria-hidden="true" /> Xuất Excel {kind === "week" ? "báo cáo tuần" : "báo cáo tháng"}</button>
          {!summary.reportedDays && <p className="muted dr-hint">Kỳ này chưa có báo cáo ngày nào ({dmy(range.from)} – {dmy(range.to)}).</p>}
        </>
      )}
    </section>
  );
}
