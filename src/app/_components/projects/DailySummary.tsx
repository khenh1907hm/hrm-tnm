"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Download, Pencil } from "lucide-react";
import { addDays } from "../../../lib/dates";
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
export function DailySummary({ store, data, viewer, setNotice, refreshKey, reload }: Pick<TabProps, "store" | "data" | "viewer" | "setNotice" | "reload"> & { refreshKey: number }) {
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

  // Công lũy kế từ đầu dự án đến hết kỳ = công nhập trước (dự án chạy trước khi dùng hệ thống) + công các BC ngày sau mốc
  const opening = project.openingWorkdays ?? 0;
  const openingAsOf = project.openingAsOf ?? null;
  const cumFrom = openingAsOf ? addDays(openingAsOf, 1) : (project.actualStart ?? project.plannedStart);
  const cumKey = `${cumFrom}|${range.to}|${refreshKey}`;
  const [cumulative, setCumulative] = useState<{ key: string; workdays: number } | null>(null);
  useEffect(() => {
    let active = true;
    if (cumFrom > range.to) return () => { active = false; };
    void store.listDailyReports(project.id, { from: cumFrom, to: range.to }).then(
      (list) => { if (active) setCumulative({ key: cumKey, workdays: list.reduce((sum, report) => sum + (report.present ?? 0), 0) }); },
      () => { if (active) setCumulative(null); },
    );
    return () => { active = false; };
  }, [store, project.id, cumFrom, range.to, cumKey]);
  // Kỳ đang xem nằm trước mốc nhập công cũ thì không tính lũy kế
  const afterOpening = cumFrom > range.to ? 0 : cumulative?.key === cumKey ? cumulative.workdays : null;
  const cumulativeWorkdays = openingAsOf && openingAsOf > range.to ? null : afterOpening === null ? null : opening + afterOpening;
  const canEditOpening = viewer.isLead || viewer.canEditProject;
  const [editingOpening, setEditingOpening] = useState<{ workdays: string; asOf: string } | null>(null);
  const saveOpening = async () => {
    if (!editingOpening) return;
    const workdays = Number(editingOpening.workdays.replace(",", "."));
    if (!Number.isFinite(workdays) || workdays < 0) { setNotice("Số công nhập trước phải là số không âm.", "error"); return; }
    if (workdays > 0 && !editingOpening.asOf) { setNotice("Chọn ngày: số công tính đến hết ngày nào.", "error"); return; }
    try {
      await store.saveProject({ ...project, openingWorkdays: workdays, openingAsOf: workdays > 0 ? editingOpening.asOf : null });
      setEditingOpening(null);
      setNotice("Đã lưu số công nhập trước.", "success");
      await reload();
    } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const summary = useMemo(() => reports ? summarizeDailyReports(reports, range, { weeklyOff: project.weeklyOff, holidays, stdHours: project.stdHours, today, startDate: project.actualStart ?? project.plannedStart }) : null, [reports, range, project.weeklyOff, project.stdHours, project.actualStart, project.plannedStart, holidays, today]);
  const isCurrent = range.from <= today && today <= range.to;

  const exportExcel = async () => {
    if (!summary) return;
    try {
      const bytes = await buildDailySummaryWorkbook({ project, kind, summary, exportedBy: viewer.isAdmin ? "Admin" : "PM / CHT", exportedOn: today,
        cumulative: cumulativeWorkdays === null ? null : { workdays: cumulativeWorkdays, opening, openingAsOf } });
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
            <div><span>Tổng công</span><b>{summary.workdays}</b><small>trong kỳ</small></div>
            <div><span>Công lũy kế</span><b>{cumulativeWorkdays ?? (openingAsOf && openingAsOf > range.to ? "—" : "…")}</b><small>{opening ? `gồm ${opening} công đến ${dmy(openingAsOf ?? "")}` : "từ đầu dự án"}{canEditOpening && <button type="button" className="link-button" style={{ marginLeft: 6 }} aria-label="Sửa số công nhập trước" title="Nhập số công đã làm trước khi dùng hệ thống" onClick={() => setEditingOpening({ workdays: String(opening || ""), asOf: openingAsOf ?? addDays(cumFrom, -1) })}><Pencil size={12} aria-hidden="true" /></button>}</small></div>
            <div><span>Giờ công</span><b>{summary.regularHours}</b><small>{project.stdHours} giờ/công</small></div>
            <div><span>Tăng ca</span><b>{summary.otHours} giờ</b><small>{summary.otPersonDays} lượt người</small></div>
            <div><span>Hiện diện TB</span><b>{summary.avgPresent}</b><small>cao nhất {summary.maxPresent}</small></div>
            <div className={summary.missingDates.length ? "warn" : ""}><span>Thiếu báo cáo</span><b>{summary.missingDates.length}</b><small>{summary.missingDates.length ? summary.missingDates.map(dm).join(", ") : "Đủ"}</small></div>
          </div>

          {editingOpening && (
            <div className="bs-head" role="group" aria-label="Công nhập trước">
              <label className="field"><span>Số công đã làm trước (người × ngày)</span><input inputMode="decimal" autoFocus value={editingOpening.workdays} placeholder="vd: 1250" onChange={(event) => setEditingOpening({ ...editingOpening, workdays: event.target.value })} /></label>
              <label className="field"><span>Tính đến hết ngày</span><input type="date" value={editingOpening.asOf} onChange={(event) => setEditingOpening({ ...editingOpening, asOf: event.target.value })} /></label>
              <div className="button-row" style={{ alignSelf: "end" }}>
                <button type="button" className="button" onClick={() => setEditingOpening(null)}>Hủy</button>
                <button type="button" className="button primary" onClick={() => void saveOpening()}>Lưu</button>
              </div>
              <small className="muted" style={{ gridColumn: "1 / -1" }}>Dùng cho dự án chạy trước khi có hệ thống: công lũy kế = số này + công của các báo cáo ngày sau ngày đã chọn.</small>
            </div>
          )}

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
