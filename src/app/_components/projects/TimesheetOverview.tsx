"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { addDays } from "../../../lib/dates";
import { normalizeText } from "../../../lib/text";
import { dayKind, weekdayShort } from "../../../modules/projects/calendar";
import { formatHours } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import { activeOn, teamsOf } from "../../../modules/projects/tree";
import { ATTENDANCE_LABELS, MEMBER_ROLE_LABELS, TIMESHEET_STATUS_LABELS, type Holiday, type Project, type ProjectMember, type Timesheet, type TimesheetLine } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage } from "./projectShared";
import { teamLabel } from "./TimesheetEntry";

type ProjectDay = { project: Project; members: ProjectMember[]; sheets: Timesheet[] };
type PersonRow = { member: ProjectMember; project: Project; sheet: Timesheet | null; line: TimesheetLine | null; otherProjects: string[] };
type Filter = "all" | "present" | "absent" | "missing";

const STATUS_TONE = { draft: "", submitted: "warn", approved: "ok", rejected: "bad" } as const;

/** Tình trạng chấm công của một người trong ngày (dùng cho cột Trạng thái và bộ lọc). */
function personState(row: PersonRow): Filter {
  if (!row.line || !row.sheet || row.sheet.status === "draft" || row.sheet.status === "rejected") return "missing";
  return row.line.attendance === "present" ? "present" : "absent";
}

/**
 * Tổng hợp chấm công (Admin, người có quyền xem dự án, PM, CHT): chọn một ngày, xem mỗi dự án đang thi công có những ai,
 * ai có mặt, vắng, tổ nào chưa nộp phiếu, phiếu nào chờ duyệt. Chỉ xem, không nhập công.
 */
export function TimesheetOverview(props: { store: ProjectStore; projects: Project[]; holidays: Holiday[]; today: string; onOpenProject?: (projectId: string) => void; setNotice: Notify }) {
  const { store, projects, setNotice } = props;
  const [date, setDate] = useState(props.today);
  const [days, setDays] = useState<ProjectDay[] | null>(null);
  const [projectFilter, setProjectFilter] = useState("*");
  const [stateFilter, setStateFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all(projects.map(async (project) => {
      const [members, sheets] = await Promise.all([store.listMembers(project.id), store.listTimesheets(project.id, date, date)]);
      return { project, members: members.filter((member) => activeOn(member, date)), sheets };
    })).then((next) => { if (active) setDays(next); }, (error: unknown) => { if (active) { setNotice(errorMessage(error), "error"); setDays([]); } });
    return () => { active = false; };
  }, [store, projects, date, setNotice]);

  const rows = useMemo<PersonRow[]>(() => {
    if (!days) return [];
    const all = days.flatMap(({ project, members, sheets }) => members.map((member) => {
      const sheet = sheets.find((item) => item.team === member.team) ?? null;
      return { member, project, sheet, line: sheet?.lines.find((line) => line.employeeId === member.employeeId) ?? null, otherProjects: [] as string[] };
    }));
    // Một người thuộc nhiều dự án đang thi công: ghi chú để kiểm soát chấm trùng
    for (const row of all) row.otherProjects = all.filter((other) => other.member.employeeId === row.member.employeeId && other.project.id !== row.project.id).map((other) => other.project.code);
    return all;
  }, [days]);

  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  const shown = rows.filter((row) => (projectFilter === "*" || row.project.id === projectFilter)
    && (stateFilter === "all" || personState(row) === stateFilter)
    && tokens.every((token) => normalizeText(`${row.member.displayName} ${row.member.employeeCode} ${row.member.team}`).includes(token)))
    .sort((a, b) => a.project.code.localeCompare(b.project.code) || a.member.team.localeCompare(b.member.team, "vi") || a.member.displayName.localeCompare(b.member.displayName, "vi"));

  const count = (state: Filter) => rows.filter((row) => personState(row) === state).length;
  const teamsWithManagement = (members: readonly ProjectMember[]) => [...teamsOf(members), ...(members.some((member) => !member.team) ? [""] : [])];
  const missingTeams = (days ?? []).flatMap(({ project, members, sheets }) => teamsWithManagement(members).filter((team) => !sheets.some((sheet) => sheet.team === team && (sheet.status === "submitted" || sheet.status === "approved"))).map((team) => ({ project, team })));
  const pending = (days ?? []).flatMap(({ project, sheets }) => sheets.filter((sheet) => sheet.status === "submitted").map((sheet) => ({ project, sheet })));
  const kind = (project: Project) => dayKind(date, project.weeklyOff, props.holidays);

  return (
    <div className="pj-page">
      <div className="pj-toolbar">
        <button type="button" className="button icon-button" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <label className="sr-only" htmlFor="ov-date">Ngày</label>
        <input id="ov-date" type="date" value={date} max={props.today} onChange={(event) => event.target.value && setDate(event.target.value)} />
        <button type="button" className="button icon-button" aria-label="Ngày sau" disabled={date >= props.today} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
        <b>{weekdayShort(date)} {date.split("-").reverse().join("/")}</b>
        {date !== props.today && <button type="button" className="link-button" onClick={() => setDate(props.today)}>Về hôm nay</button>}
      </div>

      {!days ? <div className="loading">Đang tải chấm công…</div> : !projects.length ? <div className="panel empty-state"><p>Không có dự án nào đang thi công.</p></div> : <>
        <div className="pj-kpis">
          <div className="pj-kpi"><span>Đang thi công</span><b>{projects.length} dự án</b><small>{rows.length} người trong dự án</small></div>
          <div className="pj-kpi"><span>Có mặt</span><b>{count("present")}</b><small>Theo phiếu đã gửi hoặc đã duyệt</small></div>
          <div className={`pj-kpi ${count("absent") ? "warn" : ""}`}><span>Vắng</span><b>{count("absent")}</b><small>Có phép, không phép, nghỉ lễ</small></div>
          <div className={`pj-kpi ${missingTeams.length ? "warn" : ""}`}><span>Chưa chấm</span><b>{count("missing")} người</b><small>{missingTeams.length ? `${missingTeams.length} tổ chưa nộp phiếu` : "Các tổ đã nộp đủ"}</small></div>
          <div className={`pj-kpi ${pending.length ? "warn" : ""}`}><span>Phiếu chờ duyệt</span><b>{pending.length}</b><small>{pending.length ? "CHT hoặc PM cần duyệt" : "Không có"}</small></div>
        </div>

        <section className="panel pj-section" aria-labelledby="ov-projects-title">
          <h2 id="ov-projects-title">Theo dự án và tổ</h2>
          <div className="table-scroll">
            <table className="pj-table">
              <thead><tr><th>Dự án</th><th>Tổ</th><th>Phiếu công</th><th className="pj-num">Có mặt</th><th className="pj-num">Giờ thường</th><th className="pj-num">Tăng ca</th><th /></tr></thead>
              <tbody>
                {days.flatMap(({ project, members, sheets }) => {
                  const teams = teamsWithManagement(members);
                  if (!teams.length) return [<tr key={project.id}><td>{project.code} · {project.name}</td><td colSpan={6} className="muted">Chưa có thành viên</td></tr>];
                  return teams.map((team, index) => {
                    const sheet = sheets.find((item) => item.team === team) ?? null;
                    const size = members.filter((member) => member.team === team).length;
                    const lines = sheet && sheet.status !== "draft" && sheet.status !== "rejected" ? sheet.lines : [];
                    return (
                      <tr key={`${project.id}|${team}`}>
                        {index === 0 && <td rowSpan={teams.length}><b>{project.code}</b><br /><small className="muted">{project.name}</small>{kind(project) !== "workday" && <><br /><span className="pill warn">{kind(project) === "holiday" ? "Ngày lễ" : "Ngày nghỉ tuần"}</span></>}</td>}
                        <td>{teamLabel(team)}</td>
                        <td>{sheet ? <span className={`pill ${STATUS_TONE[sheet.status]}`}>{TIMESHEET_STATUS_LABELS[sheet.status]}</span> : <span className="pill bad">Chưa chấm</span>}</td>
                        <td className="pj-num">{lines.length ? `${lines.filter((line) => line.attendance === "present").length}/${size}` : `—/${size}`}</td>
                        <td className="pj-num">{lines.length ? formatHours(lines.reduce((sum, line) => sum + line.regularHours, 0)) : "—"}</td>
                        <td className="pj-num">{lines.length ? formatHours(lines.reduce((sum, line) => sum + line.otHours, 0)) : "—"}</td>
                        {index === 0 && <td rowSpan={teams.length}>{props.onOpenProject && <button type="button" className="link-button" onClick={() => props.onOpenProject!(project.id)}><ExternalLink className="ico" size={14} aria-hidden="true" /> Mở dự án</button>}</td>}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel pj-section" aria-labelledby="ov-people-title">
          <h2 id="ov-people-title">Ai đang ở dự án nào ({shown.length}/{rows.length} người)</h2>
          <div className="pj-toolbar">
            <label className="sr-only" htmlFor="ov-search">Tìm người</label>
            <input id="ov-search" type="search" placeholder="Tìm theo tên, mã nhân viên, tổ" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label className="sr-only" htmlFor="ov-project">Dự án</label>
            <select id="ov-project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="*">Tất cả dự án</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="ov-state">Trạng thái</label>
            <select id="ov-state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as Filter)}>
              <option value="all">Mọi trạng thái</option>
              <option value="present">Có mặt</option>
              <option value="absent">Vắng</option>
              <option value="missing">Chưa chấm</option>
            </select>
          </div>
          {!shown.length ? <p className="muted">Không có ai khớp bộ lọc.</p> : (
            <div className="table-scroll">
              <table className="pj-table">
                <thead><tr><th>Mã</th><th>Họ tên</th><th>Dự án</th><th>Tổ</th><th>Vai trò</th><th>Trạng thái ngày</th><th className="pj-num">Giờ thường</th><th className="pj-num">Tăng ca</th><th>Ghi chú</th></tr></thead>
                <tbody>{shown.map((row) => {
                  const state = personState(row);
                  return (
                    <tr key={`${row.project.id}|${row.member.id}`}>
                      <td>{row.member.employeeCode}</td>
                      <td>{row.member.displayName}</td>
                      <td>{row.project.code}</td>
                      <td>{teamLabel(row.member.team)}</td>
                      <td>{MEMBER_ROLE_LABELS[row.member.role]}</td>
                      <td>{state === "missing" ? <span className="pill bad">Chưa chấm</span> : state === "present" ? <span className="pill ok">Có mặt</span> : <span className="pill warn">{ATTENDANCE_LABELS[row.line!.attendance]}</span>}
                        {row.sheet?.status === "submitted" && <small className="muted"> · chờ duyệt</small>}</td>
                      <td className="pj-num">{state === "present" ? formatHours(row.line!.regularHours) : "—"}</td>
                      <td className="pj-num">{state === "present" && row.line!.otHours ? formatHours(row.line!.otHours) : "—"}</td>
                      <td>{row.otherProjects.length ? <span className="warn-text">Cũng ở {row.otherProjects.join(", ")}</span> : ""}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </div>
  );
}
