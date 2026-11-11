"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { systemClock, todayVN } from "../../../lib/clock";
import { hasAccess, type Actor } from "../../../modules/auth/permissions";
import type { ProjectStore } from "../../../modules/projects/store";
import type { AttendanceCheck } from "../../../modules/projects/attendance";
import { teamsOf } from "../../../modules/projects/tree";
import type { Holiday, LaborSettings, PeriodLock, Project, ProjectMember, Timesheet } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, viewerFor } from "./projectShared";
import { teamLabel, TimesheetEntry } from "./TimesheetEntry";
import { TimesheetOverview } from "./TimesheetOverview";
import { SelfCheckIn } from "./SelfCheckIn";
import { RequestsPanel } from "./RequestsPanel";
import "./projects.css";

type Choice = { project: Project; team: string };
type Loaded = { members: ProjectMember[]; timesheets: Timesheet[]; locks: PeriodLock[]; checks: AttendanceCheck[] };
type Mode = "overview" | "entry" | "self";

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
  const [pmProjects, setPmProjects] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [demoPeople, setDemoPeople] = useState<ProjectMember[]>([]);
  const [demoAs, setDemoAs] = useState("");
  const [selfKey, setSelfKey] = useState(0);
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
        const pmOf = new Set<string>();
        const everyone: ProjectMember[] = [];
        for (const project of running) {
          const members = await store.listMembers(project.id);
          everyone.push(...members);
          const own = ownTeams(project, members, me);
          for (const team of own.teams) options.push({ project, team });
          if (seesAll || own.leads) supervised.push(project);
          if (actor.role === "admin" || (me !== null && (project.pmEmployeeId === me || members.some((item) => item.employeeId === me && item.role === "pm")))) pmOf.add(project.id);
        }
        // Tổ viên không đọc được danh sách thành viên: hỏi máy chủ mình thuộc dự án nào
        // Mọi tài khoản đã liên kết hồ sơ đều có trang Tự chấm công (chưa thuộc dự án thì trang báo cần làm gì)
        const member = me !== null;
        if (!active) return;
        setCommon({ settings, holidays, me });
        setChoices(options);
        setOverviewProjects(supervised);
        setPmProjects(pmOf);
        setIsMember(member);
        setDemoPeople(store.actAs ? everyone : []);
        setMode(seesAll ? "overview" : options.length ? "entry" : member || store.actAs ? "self" : supervised.length ? "overview" : "self");
      } catch (error) { if (active) { setNotice(errorMessage(error), "error"); setChoices([]); setMode("entry"); } }
    })();
    return () => { active = false; };
  }, [props.ready, store, seesAll, actor.role, setNotice]);

  const choice = choices?.[picked] ?? null;
  const year = date.slice(0, 4);
  const fetchSheets = useCallback(async (): Promise<Loaded | null> => {
    if (!choice) return null;
    const [members, timesheets, locks, checks] = await Promise.all([store.listMembers(choice.project.id), store.listTimesheets(choice.project.id, `${year}-01-01`, today), store.listLocks(choice.project.id), store.listChecks(choice.project.id, `${year}-01-01`, today)]);
    return { members, timesheets, locks, checks };
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
  const canSelf = isMember || Boolean(store.actAs);
  const modes = ([["overview", "Tổng hợp", canOverview], ["entry", "Chấm công tổ", canEntry], ["self", "Tự chấm công", canSelf]] as const).filter(([, , allowed]) => allowed);

  return (
    <section className="pj-page">
      <div className="page-head">
        <div>
          <h1>Chấm công</h1>
          <p>{mode === "overview" ? "Tổng hợp theo ngày: dự án nào có những ai, ai có mặt, ai vắng, tổ nào chưa nộp phiếu." : mode === "self" ? "Chấm Vào khi đến và Ra khi về: bật định vị, đứng tại công trường và chụp ảnh khuôn mặt." : "Chấm cho cả tổ: mặc định mọi người có mặt đủ giờ; chạm tên để đổi vắng, bấm +/− để chỉnh giờ."}</p>
        </div>
        {modes.length > 1 && (
          <div className="role-switch" role="group" aria-label="Chế độ">
            {modes.map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
          </div>
        )}
      </div>
      {!choices || !mode || !common ? <div className="loading">Đang tải…</div> : mode === "self" ? (
        <>
          {store.actAs && <div className="pj-toolbar">
            <label htmlFor="demo-as" className="muted">Bản demo · thử chấm như:</label>
            <select id="demo-as" value={demoAs} onChange={(event) => { setDemoAs(event.target.value); store.actAs!(event.target.value || null); setSelfKey((value) => value + 1); }}>
              <option value="">— Chọn một thành viên —</option>
              {[...new Map(demoPeople.map((item) => [item.employeeId, item])).values()].map((item) => <option key={item.employeeId} value={item.employeeId}>{item.employeeCode} · {item.displayName}</option>)}
            </select>
          </div>}
          <SelfCheckIn key={selfKey} store={store} holidays={common.holidays} setNotice={setNotice} />
        </>
      ) : mode === "overview" ? (
        <>
          <RequestsPanel store={store} projectLabel={(projectId) => overviewProjects.find((item) => item.id === projectId)?.code ?? "—"} isPmOf={(projectId) => actor.role === "admin" || pmProjects.has(projectId)} setNotice={setNotice} />
          <TimesheetOverview store={store} projects={overviewProjects} holidays={common.holidays} today={today} setNotice={setNotice} {...(props.onOpenProject ? { onOpenProject: props.onOpenProject } : {})} />
        </>
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
              today={today} team={choice.team} date={date} onDateChange={setDate} isLead={viewer.isLead} isAdmin={viewer.isAdmin} onChanged={reload} setNotice={setNotice} checks={loaded.checks} />
          )}
        </>
      )}
    </section>
  );
}
