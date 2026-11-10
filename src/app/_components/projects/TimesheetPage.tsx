"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { systemClock, todayVN } from "../../../lib/clock";
import { hasAccess, type Actor } from "../../../modules/auth/permissions";
import type { ProjectStore } from "../../../modules/projects/store";
import { teamsOf } from "../../../modules/projects/tree";
import type { Holiday, LaborSettings, PeriodLock, Project, ProjectMember, Timesheet } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, viewerFor } from "./projectShared";
import { teamLabel, TimesheetEntry } from "./TimesheetEntry";
import { TimesheetOverview } from "./TimesheetOverview";
import "./projects.css";

type Choice = { project: Project; team: string };
type Loaded = { members: ProjectMember[]; timesheets: Timesheet[]; locks: PeriodLock[] };
type Mode = "overview" | "entry";

/**
 * Các tổ mà chính người này nhập công, theo vai trò trong dự án (không theo vai trò hệ thống):
 * PM hoặc CHT của dự án nhập được mọi tổ của dự án đó; tổ trưởng chỉ tổ của mình. Admin không thuộc dự án thì không nhập công.
 */
function ownTeams(project: Project, members: readonly ProjectMember[], me: string | null): { teams: string[]; leads: boolean } {
  if (!me) return { teams: [], leads: false };
  const mine = members.filter((member) => member.employeeId === me);
  const leads = project.pmEmployeeId === me || mine.some((member) => member.role === "pm" || member.role === "commander");
  if (leads) return { teams: [...teamsOf(members), ...(members.some((member) => !member.team) ? [""] : [])], leads };
  return { teams: mine.filter((member) => member.role === "leader" && member.team).map((member) => member.team), leads };
}

/**
 * Trang Chấm công (/cham-cong).
 * Tổng hợp: Admin, người có quyền xem dự án, PM, CHT xem mỗi dự án có ai, ai có mặt, tổ nào chưa nộp (chỉ xem).
 * Nhập công: tổ trưởng (và PM, CHT trong dự án của mình) chấm cho tổ, tối ưu cho điện thoại.
 */
export function TimesheetPage(props: { store: ProjectStore; ready: boolean; actor: Actor; setNotice: Notify; onOpenProject?: (projectId: string) => void }) {
  const { store, actor, setNotice } = props;
  const today = todayVN(systemClock);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [overviewProjects, setOverviewProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [picked, setPicked] = useState(0);
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [common, setCommon] = useState<{ settings: LaborSettings; holidays: Holiday[]; me: string | null } | null>(null);
  const seesAll = actor.role === "admin" || hasAccess(actor, "projects.view");

  useEffect(() => {
    if (!props.ready) return;
    let active = true;
    void (async () => {
      try {
        const [projects, settings, holidays, me] = await Promise.all([store.listProjects(), store.getSettings(), store.listHolidays(), store.myEmployeeId()]);
        const running = projects.filter((project) => project.status === "active");
        const options: Choice[] = [];
        const supervised: Project[] = [];
        for (const project of running) {
          const own = ownTeams(project, await store.listMembers(project.id), me);
          for (const team of own.teams) options.push({ project, team });
          if (seesAll || own.leads) supervised.push(project);
        }
        if (!active) return;
        setCommon({ settings, holidays, me });
        setChoices(options);
        setOverviewProjects(supervised);
        setMode(seesAll || (!options.length && supervised.length) ? "overview" : "entry");
      } catch (error) { if (active) { setNotice(errorMessage(error), "error"); setChoices([]); setMode("entry"); } }
    })();
    return () => { active = false; };
  }, [props.ready, store, seesAll, setNotice]);

  const choice = choices?.[picked] ?? null;
  const year = date.slice(0, 4);
  const fetchSheets = useCallback(async (): Promise<Loaded | null> => {
    if (!choice) return null;
    const [members, timesheets, locks] = await Promise.all([store.listMembers(choice.project.id), store.listTimesheets(choice.project.id, `${year}-01-01`, today), store.listLocks(choice.project.id)]);
    return { members, timesheets, locks };
  }, [choice, store, year, today]);
  const reload = useCallback(async () => { try { setLoaded(await fetchSheets()); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchSheets, setNotice]);
  useEffect(() => {
    let active = true;
    void fetchSheets().then((next) => { if (active) setLoaded(next); }, (error: unknown) => { if (active) setNotice(errorMessage(error), "error"); });
    return () => { active = false; };
  }, [fetchSheets, setNotice]);

  const viewer = useMemo(() => choice && loaded && common ? viewerFor(actor, common.me, choice.project, loaded.members) : null, [choice, loaded, common, actor]);
  const canOverview = overviewProjects.length > 0 || seesAll;
  const canEntry = (choices?.length ?? 0) > 0;

  return (
    <section className="pj-page">
      <div className="page-head">
        <div>
          <h1>Chấm công</h1>
          <p>{mode === "overview" ? "Tổng hợp theo ngày: dự án nào có những ai, ai có mặt, ai vắng, tổ nào chưa nộp phiếu." : "Chấm cho cả tổ: mặc định mọi người có mặt đủ giờ; chạm tên để đổi vắng, bấm +/− để chỉnh giờ."}</p>
        </div>
        {canOverview && canEntry && (
          <div className="role-switch" role="group" aria-label="Chế độ">
            <button type="button" aria-pressed={mode === "overview"} onClick={() => setMode("overview")}>Tổng hợp</button>
            <button type="button" aria-pressed={mode === "entry"} onClick={() => setMode("entry")}>Chấm công tổ của tôi</button>
          </div>
        )}
      </div>
      {!choices || !mode || !common ? <div className="loading">Đang tải…</div> : mode === "overview" ? (
        <TimesheetOverview store={store} projects={overviewProjects} holidays={common.holidays} today={today} setNotice={setNotice} {...(props.onOpenProject ? { onOpenProject: props.onOpenProject } : {})} />
      ) : !choices.length ? (
        <div className="panel empty-state"><p>Bạn chưa phụ trách tổ nào ở dự án đang thi công.</p><small className="muted">Nhờ PM hoặc chỉ huy trưởng thêm bạn vào dự án với vai trò Tổ trưởng, và nhờ Admin liên kết tài khoản với hồ sơ nhân sự của bạn.</small></div>
      ) : (
        <>
          {choices.length > 1 && <div className="pj-toolbar">
            <label className="sr-only" htmlFor="ts-pick">Dự án và tổ</label>
            <select id="ts-pick" value={picked} onChange={(event) => { setPicked(Number(event.target.value)); setLoaded(null); }} style={{ flex: 1 }}>
              {choices.map((item, index) => <option key={`${item.project.id}|${item.team}`} value={index}>{item.project.code} · {teamLabel(item.team)}</option>)}
            </select>
          </div>}
          {!loaded || !viewer || !choice ? <div className="loading">Đang tải phiếu công…</div> : (
            <TimesheetEntry store={store} project={choice.project} members={loaded.members} timesheets={loaded.timesheets} settings={common.settings} holidays={common.holidays} locks={loaded.locks}
              today={today} team={choice.team} date={date} onDateChange={setDate} isLead={viewer.isLead} isAdmin={viewer.isAdmin} onChanged={reload} setNotice={setNotice} />
          )}
        </>
      )}
    </section>
  );
}
