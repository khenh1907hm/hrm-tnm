"use client";
import { useMemo, useState } from "react";
import { Download, Lock, LockOpen, RefreshCw } from "lucide-react";
import { addDays } from "../../../lib/dates";
import { dayKind, monthRange, weekdayShort, weekStart } from "../../../modules/projects/calendar";
import { formatHours, formatVnd } from "../../../modules/projects/cost";
import { dailyStatus, flattenTimesheets, hoursMatrix, inRange, summarizeByPerson, type PersonSummary } from "../../../modules/projects/reports";
import { buildMonthlyTimesheetWorkbook } from "../../../modules/projects/timesheetWorkbook";
import { teamsOf } from "../../../modules/projects/tree";
import { downloadXlsx } from "../profileExport";
import type { TabProps } from "./ProjectDetail";
import { errorMessage } from "./projectShared";
import { teamLabel } from "./TimesheetEntry";

type Mode = "day" | "week" | "month";

/** Báo cáo ngày, tuần, tháng (spec mục 6). Cột tiền chỉ hiện với Admin và PM. */
export function ReportsTab({ store, data, viewer, reload, setNotice }: TabProps) {
  const [mode, setMode] = useState<Mode>("month");
  const [date, setDate] = useState(data.today);
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [team, setTeam] = useState<string>("*");
  const teams = teamsOf(data.members);
  const allRows = useMemo(() => flattenTimesheets(data.timesheets, data.costs), [data.timesheets, data.costs]);
  const rows = team === "*" ? allRows : allRows.filter((row) => row.team === team);
  const money = viewer.canSeeMoney;

  const range = mode === "day" ? { from: date, to: date } : mode === "week" ? { from: weekStart(date), to: addDays(weekStart(date), 6) } : monthRange(month);
  const scoped = inRange(rows, range.from, range.to);
  const people = summarizeByPerson(scoped, data.members, data.settings);
  const locked = data.locks.some((lock) => lock.month === month);

  const exportMonth = async () => {
    try {
      const bytes = await buildMonthlyTimesheetWorkbook({ project: data.project, month, members: data.members, rows, settings: data.settings, holidays: data.holidays, showMoney: money, exportedBy: viewer.isAdmin ? "Admin" : "PM" });
      downloadXlsx(bytes, `BangCong_${data.project.code}_${month}.xlsx`);
      setNotice("Đã xuất bảng công tháng.", "success");
    } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const act = async (action: () => Promise<unknown>, done: string) => {
    try { await action(); setNotice(done, "success"); await reload(); } catch (error) { setNotice(errorMessage(error), "error"); }
  };
  const lockMonth = () => {
    const { from, to } = monthRange(month);
    const pending = data.timesheets.filter((sheet) => sheet.workDate >= from && sheet.workDate <= to && sheet.status !== "approved");
    if (pending.length && !window.confirm(`Tháng ${month} còn ${pending.length} phiếu chưa duyệt (nháp, chờ duyệt hoặc bị từ chối). Phiếu chưa duyệt sẽ không được tính tiền. Vẫn khóa sổ?`)) return;
    void act(() => store.lockMonth(data.project.id, month), `Đã khóa sổ tháng ${month}.`);
  };

  return (
    <div className="pj-page">
      <div className="pj-toolbar">
        <div className="role-switch" role="group" aria-label="Loại báo cáo">
          {([["day", "Ngày"], ["week", "Tuần"], ["month", "Tháng"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
        </div>
        {mode === "month"
          ? <><label className="sr-only" htmlFor="rp-month">Tháng</label><input id="rp-month" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></>
          : <><label className="sr-only" htmlFor="rp-date">Ngày</label><input id="rp-date" type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></>}
        {teams.length > 1 && <><label className="sr-only" htmlFor="rp-team">Tổ</label><select id="rp-team" value={team} onChange={(event) => setTeam(event.target.value)}><option value="*">Tất cả tổ</option>{teams.map((item) => <option key={item} value={item}>{item}</option>)}</select></>}
        <span className="muted">{range.from === range.to ? range.from.split("-").reverse().join("/") : `${range.from.split("-").reverse().join("/")} – ${range.to.split("-").reverse().join("/")}`}</span>
      </div>

      {mode === "day" && <DayStatus data={data} date={date} teams={team === "*" ? [...teams, ...(data.members.some((member) => !member.team) ? [""] : [])] : [team]} />}
      {mode === "week" && <WeekMatrix rows={scoped} people={people} from={range.from} data={data} />}

      <section className="panel pj-section" aria-labelledby="rp-people-title">
        <div className="pj-section-head">
          <h2 id="rp-people-title">Giờ công {money ? "và tiền công " : ""}theo người</h2>
          {mode === "month" && (money || viewer.isLead) && <div className="button-row">
            <button type="button" className="button" onClick={() => void exportMonth()}><Download className="ico" size={16} aria-hidden="true" /> Xuất Excel bảng công</button>
            {viewer.isAdmin && (locked
              ? <button type="button" className="button" onClick={() => { const why = window.prompt("Lý do mở khóa sổ (ít nhất 5 ký tự):") ?? ""; if (why) void act(() => store.unlockMonth(data.project.id, month, why), `Đã mở khóa sổ tháng ${month}.`); }}><LockOpen className="ico" size={16} aria-hidden="true" /> Mở khóa sổ</button>
              : <button type="button" className="button" onClick={lockMonth}><Lock className="ico" size={16} aria-hidden="true" /> Khóa sổ tháng</button>)}
            {viewer.isAdmin && !locked && <button type="button" className="button" title="Tính lại tiền công các phiếu đã duyệt trong tháng theo đơn giá hiện tại" onClick={() => { const { from, to } = monthRange(month); void act(() => store.recalcCosts(data.project.id, from, to), "Đã tính lại tiền công các phiếu đã duyệt trong tháng."); }}><RefreshCw className="ico" size={16} aria-hidden="true" /> Tính lại tiền</button>}
          </div>}
        </div>
        {locked && mode === "month" && <p className="muted"><Lock className="ico" size={14} aria-hidden="true" /> Tháng {month} đã khóa sổ: không ai sửa được chấm công của tháng này.</p>}
        <PeopleTable people={people} money={money} maxOt={data.settings.maxOtMonth} showOtCap={mode === "month"} />
      </section>
    </div>
  );
}

function DayStatus({ data, date, teams }: { data: TabProps["data"]; date: string; teams: string[] }) {
  const status = dailyStatus(date, data.timesheets, teams);
  const kind = dayKind(date, data.project.weeklyOff, data.holidays);
  const absent = status.sheets.flatMap((sheet) => sheet.lines.filter((line) => line.attendance !== "present").map((line) => data.members.find((member) => member.employeeId === line.employeeId)?.displayName ?? line.employeeId));
  return (
    <section className="panel pj-section" aria-labelledby="rp-day-title">
      <h2 id="rp-day-title">Tình hình ngày {date.split("-").reverse().join("/")} ({weekdayShort(date)}{kind !== "workday" ? kind === "holiday" ? ", ngày lễ" : ", ngày nghỉ tuần" : ""})</h2>
      <div className="pj-kpis">
        <div className={`pj-kpi ${status.missingTeams.length ? "warn" : ""}`}><span>Tổ chưa nộp phiếu</span><b>{status.missingTeams.length}</b><small>{status.missingTeams.map(teamLabel).join(", ") || "Đã nộp đủ"}</small></div>
        <div className={`pj-kpi ${status.pending.length ? "warn" : ""}`}><span>Phiếu chờ duyệt</span><b>{status.pending.length}</b><small>{status.pending.map((sheet) => teamLabel(sheet.team)).join(", ") || "Không có"}</small></div>
        <div className="pj-kpi"><span>Vắng mặt</span><b>{absent.length}</b><small>{absent.join(", ") || "Không ai vắng"}</small></div>
      </div>
    </section>
  );
}

function WeekMatrix({ rows, people, from, data }: { rows: ReturnType<typeof inRange>; people: PersonSummary[]; from: string; data: TabProps["data"] }) {
  const matrix = hoursMatrix(rows, from, 7);
  const topOt = [...people].filter((person) => person.otHours > 0).sort((a, b) => b.otHours - a.otHours).slice(0, 10);
  return (
    <section className="panel pj-section" aria-labelledby="rp-week-title">
      <h2 id="rp-week-title">Bảng tuần (giờ thường / tăng ca)</h2>
      {!people.length ? <p className="muted">Chưa có chấm công trong tuần này.</p> : (
        <div className="table-scroll">
          <table className="pj-table pj-matrix">
            <thead><tr><th>Người</th>{matrix.dates.map((date) => <th key={date} className={dayKind(date, data.project.weeklyOff, data.holidays) === "workday" ? "" : "off"}>{weekdayShort(date)}<br />{date.slice(8, 10)}/{date.slice(5, 7)}</th>)}<th>Tổng</th></tr></thead>
            <tbody>{people.map((person) => (
              <tr key={person.employeeId}>
                <td>{person.name}<br /><small className="muted">{person.team}</small></td>
                {matrix.dates.map((date) => {
                  const cell = matrix.cell(person.employeeId, date);
                  const off = dayKind(date, data.project.weeklyOff, data.holidays) !== "workday";
                  return <td key={date} className={off ? "off" : ""}>{!cell ? "" : cell.attendance !== "present" ? <span className="muted">Vắng</span> : <>{formatHours(cell.regular)}{cell.ot ? <b className="warn-text">/{formatHours(cell.ot)}</b> : null}</>}</td>;
                })}
                <td><b>{formatHours(person.regularHours)}</b>{person.otHours ? <b className="warn-text">/{formatHours(person.otHours)}</b> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {topOt.length > 0 && <p className="muted">Tăng ca nhiều nhất tuần: {topOt.map((person) => `${person.name} (${formatHours(person.otHours)} giờ)`).join(", ")}</p>}
    </section>
  );
}

function PeopleTable({ people, money, maxOt, showOtCap }: { people: PersonSummary[]; money: boolean; maxOt: number; showOtCap: boolean }) {
  if (!people.length) return <p className="muted">Chưa có chấm công trong khoảng này.</p>;
  const sum = (pick: (person: PersonSummary) => number) => people.reduce((total, person) => total + pick(person), 0);
  return (
    <div className="table-scroll">
      <table className="pj-table">
        <thead><tr><th>Mã</th><th>Họ tên</th><th>Tổ</th><th className="pj-num">Ngày công</th><th className="pj-num">Giờ thường</th><th className="pj-num">TC thường</th><th className="pj-num">TC nghỉ tuần</th><th className="pj-num">TC lễ</th><th className="pj-num">Tổng TC</th>{money && <th className="pj-num">Thành tiền</th>}<th>Ghi chú</th></tr></thead>
        <tbody>{people.map((person) => (
          <tr key={person.employeeId}>
            <td>{person.code}</td>
            <td>{person.name}</td>
            <td>{person.team}</td>
            <td className="pj-num">{person.daysPresent}</td>
            <td className="pj-num">{formatHours(person.regularHours)}</td>
            <td className="pj-num">{formatHours(person.otByType.weekday)}</td>
            <td className="pj-num">{formatHours(person.otByType.weekly_off)}</td>
            <td className="pj-num">{formatHours(person.otByType.holiday)}</td>
            <td className="pj-num">{showOtCap && person.otOverMonth ? <span className="pill bad" title={`Quá trần ${maxOt} giờ tăng ca/tháng`}>{formatHours(person.otHours)}</span> : formatHours(person.otHours)}</td>
            {money && <td className="pj-num">{formatVnd(person.amount)}</td>}
            <td>{[person.hasPending && "Có phiếu chưa duyệt", money && person.missingRate && "Thiếu đơn giá", showOtCap && person.otOverMonth && `Quá ${maxOt} giờ TC/tháng`].filter(Boolean).join(" · ")}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td /><td>Tổng ({people.length} người)</td><td /><td className="pj-num">{sum((person) => person.daysPresent)}</td><td className="pj-num">{formatHours(sum((person) => person.regularHours))}</td><td className="pj-num">{formatHours(sum((person) => person.otByType.weekday))}</td><td className="pj-num">{formatHours(sum((person) => person.otByType.weekly_off))}</td><td className="pj-num">{formatHours(sum((person) => person.otByType.holiday))}</td><td className="pj-num">{formatHours(sum((person) => person.otHours))}</td>{money && <td className="pj-num">{formatVnd(sum((person) => person.amount))}</td>}<td /></tr></tfoot>
      </table>
    </div>
  );
}
