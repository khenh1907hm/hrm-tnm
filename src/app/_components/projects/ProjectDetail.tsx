"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import type { Actor } from "../../../modules/auth/permissions";
import { projectDuration } from "../../../modules/projects/calendar";
import type { ProjectStore } from "../../../modules/projects/store";
import type { AttendanceCheck } from "../../../modules/projects/attendance";
import {
  PROJECT_STATUS_LABELS, type ProjectFinance, type Holiday, type LaborSettings, type MemberRate, type PeriodLock, type Project, type ProjectBudget, type ProjectExpense,
  type ProjectMember, type Subcontract, type SubcontractPayment, type Timesheet, type TimesheetCost,
} from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { CostsTab } from "./CostsTab";
import { ChecksTab } from "./ChecksTab";
import { ProjectPurchasesTab } from "../purchases/ProjectPurchasesTab";
import { OrgChartTab } from "./OrgChartTab";
import { BudgetSheetTab } from "./BudgetSheetTab";
import { DailyReportTab } from "./DailyReportTab";
import { OverviewTab } from "./OverviewTab";
import { errorMessage, viewerFor, type EmployeeSource, type ProjectViewer } from "./projectShared";
import { formatDateVn } from "./ProjectsPage";
import { ReportsTab } from "./ReportsTab";
import { TimesheetsTab } from "./TimesheetsTab";

/** Toàn bộ dữ liệu một dự án (tải một lần, tải lại sau mỗi thao tác). Các mục tiền là [] khi người xem không được xem tiền. */
export type ProjectData = {
  project: Project;
  members: ProjectMember[];
  memberRates: MemberRate[];
  budgets: ProjectBudget[];
  timesheets: Timesheet[];
  costs: TimesheetCost[];
  subcontracts: Subcontract[];
  payments: SubcontractPayment[];
  expenses: ProjectExpense[];
  locks: PeriodLock[];
  /** Vốn dự án; null khi chưa nhập hoặc không được xem tiền. */
  finance: ProjectFinance | null;
  /** Lượt tự chấm công GPS của dự án (phạm vi người xem đọc được). */
  checks: AttendanceCheck[];
  holidays: Holiday[];
  settings: LaborSettings;
  myEmployeeId: string | null;
  today: string;
};

export type TabProps = {
  store: ProjectStore;
  data: ProjectData;
  viewer: ProjectViewer;
  actor: Actor;
  employees: EmployeeSource;
  reload: () => Promise<void>;
  setNotice: Notify;
};

async function fetchProjectData(store: ProjectStore, project: Project): Promise<ProjectData> {
  const today = todayVN(systemClock);
  const to = project.actualEnd ?? (project.plannedEnd > today ? project.plannedEnd : today);
  const [members, memberRates, budgets, timesheets, costs, subcontracts, payments, expenses, locks, holidays, settings, myEmployeeId, finance, checks] = await Promise.all([
    store.listMembers(project.id), store.listMemberRates(project.id), store.getBudgets(project.id), store.listTimesheets(project.id, project.plannedStart, to),
    store.listCosts(project.id, "0001-01-01", "9999-12-31"), store.listSubcontracts(project.id), store.listPayments(project.id), store.listExpenses(project.id),
    store.listLocks(project.id), store.listHolidays(), store.getSettings(), store.myEmployeeId(), store.getFinance(project.id), store.listChecks(project.id, project.plannedStart, to),
  ]);
  return { project, members, memberRates: memberRates ?? [], budgets: budgets ?? [], timesheets, costs: costs ?? [], subcontracts, payments: payments ?? [], expenses: expenses ?? [], locks, holidays, settings, myEmployeeId, finance, checks, today };
}

type Tab = "overview" | "budget" | "members" | "daily" | "timesheets" | "checks" | "purchases" | "costs" | "reports";
const TABS: readonly [Tab, string][] = [["overview", "Tổng quan"], ["budget", "Ngân sách"], ["members", "Sơ đồ & thành viên"], ["daily", "Báo cáo ngày"], ["timesheets", "Chấm công"], ["checks", "Chấm công GPS"], ["purchases", "Đặt hàng"], ["costs", "Chi phí"], ["reports", "Báo cáo"]];

export function ProjectDetail(props: { store: ProjectStore; actor: Actor; employees: EmployeeSource; project: Project; setNotice: Notify; onBack: () => void; onEdit: () => void; onChanged: () => void; children?: ReactNode }) {
  const { store, project, actor, setNotice } = props;
  const [data, setData] = useState<ProjectData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const reload = useCallback(async () => {
    try { setData(await fetchProjectData(store, project)); } catch (error) { setNotice(errorMessage(error), "error"); }
  }, [store, project, setNotice]);

  useEffect(() => {
    let active = true;
    void fetchProjectData(store, project).then((next) => { if (active) setData(next); }, (error: unknown) => { if (active) setNotice(errorMessage(error), "error"); });
    return () => { active = false; };
  }, [store, project, setNotice]);

  const viewer = useMemo(() => data ? viewerFor(actor, data.myEmployeeId, project, data.members) : null, [actor, data, project]);
  const visibleTabs = TABS.filter(([key]) => ((key !== "costs" && key !== "budget") || viewer?.canSeeMoney) && (key !== "daily" || viewer?.isLead || viewer?.canEditProject));
  const duration = data ? projectDuration(project, data.holidays, data.today) : null;

  return (
    <section className="pj-page">
      <div>
        <button type="button" className="back-button" onClick={props.onBack}><ArrowLeft className="ico" size={16} aria-hidden="true" /> Danh sách dự án</button>
        <div className="page-head">
          <div>
            <span className="pj-code">{project.code} · {PROJECT_STATUS_LABELS[project.status]}</span>
            <h1>{project.name}</h1>
            <p>{[project.customerName, project.site].filter(Boolean).join(" · ")}</p>
            <p className="muted">
              Dự kiến {formatDateVn(project.plannedStart)} – {formatDateVn(project.plannedEnd)}
              {duration && ` (${duration.planned.calendar} ngày, ${duration.planned.working} ngày làm việc)`}
              {project.actualStart && ` · Thực tế từ ${formatDateVn(project.actualStart)}${project.actualEnd ? ` đến ${formatDateVn(project.actualEnd)}` : ""}${duration?.actual ? ` (${duration.actual.working} ngày làm việc)` : ""}`}
            </p>
          </div>
          {viewer?.canEditProject && <button type="button" className="button" onClick={props.onEdit}><Pencil className="ico" size={16} aria-hidden="true" /> Sửa dự án</button>}
        </div>
      </div>
      <div className="pj-tabs" role="tablist" aria-label="Mục của dự án">
        {visibleTabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {!data || !viewer ? <div className="loading">Đang tải dữ liệu dự án…</div> : (() => {
        const tabProps: TabProps = { store, data, viewer, actor, employees: props.employees, reload: async () => { await reload(); props.onChanged(); }, setNotice };
        if (tab === "overview") return <OverviewTab {...tabProps} />;
        if (tab === "budget") return <BudgetSheetTab {...tabProps} />;
        if (tab === "members") return <OrgChartTab {...tabProps} />;
        if (tab === "daily") return <DailyReportTab {...tabProps} />;
        if (tab === "timesheets") return <TimesheetsTab {...tabProps} />;
        if (tab === "costs") return <CostsTab {...tabProps} />;
        if (tab === "checks") return <ChecksTab {...tabProps} />;
        if (tab === "purchases") return <ProjectPurchasesTab {...tabProps} />;
        return <ReportsTab {...tabProps} />;
      })()}
      {props.children}
    </section>
  );
}
