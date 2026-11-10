"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { systemClock, todayVN } from "../../../lib/clock";
import type { Actor } from "../../../modules/auth/permissions";
import type { ProjectStore } from "../../../modules/projects/store";
import { teamsOf } from "../../../modules/projects/tree";
import type { Holiday, LaborSettings, PeriodLock, Project, ProjectMember, Timesheet } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { errorMessage, viewerFor } from "./projectShared";
import { teamLabel, TimesheetEntry } from "./TimesheetEntry";
import "./projects.css";

type Choice = { project: Project; team: string };
type Loaded = { members: ProjectMember[]; timesheets: Timesheet[]; locks: PeriodLock[] };

/**
 * Trang Chấm công (/cham-cong), tối ưu cho điện thoại: mở ra là vào thẳng phiếu công hôm nay của tổ mình.
 * Tổ trưởng thấy các tổ mình phụ trách; CHT, PM thấy mọi tổ của dự án mình; Admin thấy mọi dự án đang thi công.
 */
export function TimesheetPage(props: { store: ProjectStore; ready: boolean; actor: Actor; setNotice: Notify }) {
  const { store, actor, setNotice } = props;
  const today = todayVN(systemClock);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [common, setCommon] = useState<{ settings: LaborSettings; holidays: Holiday[]; me: string | null } | null>(null);

  useEffect(() => {
    if (!props.ready) return;
    let active = true;
    void (async () => {
      try {
        const [projects, settings, holidays, me] = await Promise.all([store.listProjects(), store.getSettings(), store.listHolidays(), store.myEmployeeId()]);
        const running = projects.filter((project) => project.status === "active");
        const options: Choice[] = [];
        for (const project of running) {
          const members = await store.listMembers(project.id);
          const viewer = viewerFor(actor, me, project, members);
          const teams = viewer.isLead ? [...teamsOf(members), ...(members.some((member) => !member.team) ? [""] : [])] : viewer.leaderTeams;
          for (const team of teams) options.push({ project, team });
        }
        if (!active) return;
        setCommon({ settings, holidays, me });
        setChoices(options);
      } catch (error) { if (active) { setNotice(errorMessage(error), "error"); setChoices([]); } }
    })();
    return () => { active = false; };
  }, [props.ready, store, actor, setNotice]);

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

  return (
    <section className="pj-page">
      <div className="page-head"><div><h1>Chấm công</h1><p>Chấm cho cả tổ: mặc định mọi người có mặt đủ giờ; chạm tên để đổi vắng, bấm +/− để chỉnh giờ.</p></div></div>
      {!choices ? <div className="loading">Đang tải…</div> : !choices.length ? (
        <div className="panel empty-state"><p>Bạn chưa phụ trách tổ nào ở dự án đang thi công.</p><small className="muted">Nhờ PM hoặc chỉ huy trưởng thêm bạn vào dự án với vai trò Tổ trưởng, và nhờ Admin liên kết tài khoản với hồ sơ nhân sự của bạn.</small></div>
      ) : (
        <>
          {choices.length > 1 && <div className="pj-toolbar">
            <label className="sr-only" htmlFor="ts-pick">Dự án và tổ</label>
            <select id="ts-pick" value={picked} onChange={(event) => { setPicked(Number(event.target.value)); setLoaded(null); }} style={{ flex: 1 }}>
              {choices.map((item, index) => <option key={`${item.project.id}|${item.team}`} value={index}>{item.project.code} · {teamLabel(item.team)}</option>)}
            </select>
          </div>}
          {!loaded || !viewer || !common || !choice ? <div className="loading">Đang tải phiếu công…</div> : (
            <TimesheetEntry store={store} project={choice.project} members={loaded.members} timesheets={loaded.timesheets} settings={common.settings} holidays={common.holidays} locks={loaded.locks}
              today={today} team={choice.team} date={date} onDateChange={setDate} isLead={viewer.isLead} isAdmin={viewer.isAdmin} onChanged={reload} setNotice={setNotice} />
          )}
        </>
      )}
    </section>
  );
}
