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
import { CHAINS } from "../../../modules/purchases/approval";
import { ChecksTab } from "./ChecksTab";
import { ProjectPurchasesTab } from "../purchases/ProjectPurchasesTab";
import { OrgChartTab } from "./OrgChartTab";
import { ProjectApproversPanel } from "./ProjectApproversPanel";
import { CONTRACT_STATE_UI, myAccount, projectApprovers, projectContractStates, type ContractState } from "../accountApi";
import { BudgetSheetTab } from "./BudgetSheetTab";
import { ContractTab } from "./ContractTab";
import { MaterialsTab } from "./MaterialsTab";
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

type Tab = "overview" | "contract" | "budget" | "materials" | "members" | "daily" | "timesheets" | "checks" | "purchases" | "reports";
const TABS: readonly [Tab, string][] = [["overview", "Tổng quan"], ["contract", "Confirm Contract"], ["budget", "Ngân sách"], ["materials", "Yêu cầu vật tư"], ["purchases", "Đặt hàng"], ["members", "Sơ đồ & thành viên"], ["daily", "Báo cáo ngày"], ["timesheets", "Chấm công"], ["checks", "Chấm công GPS"], ["reports", "Báo cáo"]];
/** Mở thẳng một mục qua đường dẫn ?muc=ngan-sach (từ "Chờ tôi ký", thông báo). */
export const TAB_SLUGS: Record<Tab, string> = {
  overview: "tong-quan", contract: "hop-dong", budget: "ngan-sach", materials: "yeu-cau-vat-tu", purchases: "dat-hang", members: "so-do", daily: "bao-cao-ngay",
  timesheets: "cham-cong", checks: "cham-cong-gps", reports: "bao-cao",
};
const tabFromUrl = (): Tab => {
  if (typeof window === "undefined") return "overview";
  const slug = new URLSearchParams(window.location.search).get("muc");
  return (Object.entries(TAB_SLUGS).find(([, value]) => value === slug)?.[0] as Tab | undefined) ?? "overview";
};

export function ProjectDetail(props: { store: ProjectStore; actor: Actor; employees: EmployeeSource; project: Project; setNotice: Notify; onBack: () => void; onEdit: () => void; onChanged: () => void; children?: ReactNode }) {
  const { store, project, actor, setNotice } = props;
  const [data, setData] = useState<ProjectData | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromUrl);

  const reload = useCallback(async () => {
    try { setData(await fetchProjectData(store, project)); } catch (error) { setNotice(errorMessage(error), "error"); }
  }, [store, project, setNotice]);

  useEffect(() => {
    let active = true;
    void fetchProjectData(store, project).then((next) => { if (active) setData(next); }, (error: unknown) => { if (active) setNotice(errorMessage(error), "error"); });
    return () => { active = false; };
  }, [store, project, setNotice]);

  // Người duyệt của dự án và Giám đốc xem được ngân sách, hợp đồng để ký
  const [approverAccess, setApproverAccess] = useState({ isApprover: false, isDirector: false });
  useEffect(() => {
    if (store.mode !== "live" || !data) return;
    let active = true;
    void Promise.all([projectApprovers(project.id).catch(() => []), myAccount()]).then(([list, account]) => {
      if (active) setApproverAccess({ isApprover: Boolean(data.myEmployeeId) && list.some((item) => item.employeeId === data.myEmployeeId), isDirector: Boolean(account?.isDirector) });
    });
    return () => { active = false; };
  }, [store.mode, project.id, data]);
  const viewer = useMemo(() => data ? viewerFor(actor, data.myEmployeeId, project, data.members) : null, [actor, data, project]);
  const signsHere = approverAccess.isApprover || approverAccess.isDirector;
  const [contractState, setContractState] = useState<ContractState | null>(null);
  useEffect(() => {
    if (store.mode !== "live" || !data) return;
    let active = true;
    void projectContractStates().then((value) => { if (active) setContractState(value[project.id] ?? "none"); }, () => undefined);
    return () => { active = false; };
  }, [store.mode, project.id, data]);
  const stateUi = contractState ? CONTRACT_STATE_UI[contractState] : null;
  const visibleTabs = TABS.filter(([key]) => ((key !== "budget" && key !== "contract") || viewer?.canSeeMoney || signsHere) && (key !== "daily" || viewer?.isLead || viewer?.canEditProject));
  const duration = data ? projectDuration(project, data.holidays, data.today) : null;

  return (
    <section className="pj-page">
      <div>
        <button type="button" className="back-button" onClick={props.onBack}><ArrowLeft className="ico" size={16} aria-hidden="true" /> Danh sách dự án</button>
        <div className="page-head">
          <div>
            <span className="pj-code">{project.code} · {PROJECT_STATUS_LABELS[project.status]}</span>
            {stateUi && <span className={`cc-pill cc-${stateUi.tone}`} style={{ marginLeft: 8 }}>{stateUi.label}</span>}
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
      {stateUi && stateUi.tone !== "ok" && <div className={`cc-banner cc-${stateUi.tone}`} role="status">
        {stateUi.tone === "bad" ? "Confirm Contract bị từ chối: sửa lại ở tab Confirm Contract rồi gửi ký lại. Dự án chưa được tạo thành công." : "Dự án đang chờ: chỉ được tạo thành công khi Confirm Contract được duyệt (tab Confirm Contract, cần đính kèm Báo giá có ký)."}
        {tab !== "contract" && <button type="button" className="link-button" onClick={() => setTab("contract")}>Mở Confirm Contract</button>}
      </div>}
      <div className="pj-tabs" role="tablist" aria-label="Mục của dự án">
        {visibleTabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {!data || !viewer ? <div className="loading">Đang tải dữ liệu dự án…</div> : (() => {
        const tabProps: TabProps = { store, data, viewer, actor, employees: props.employees, reload: async () => { await reload(); props.onChanged(); }, setNotice };
        if (tab === "overview") return <OverviewTab {...tabProps} />;
        // Confirm Contract, Ngân sách, Đặt hàng: bên phải là khung người duyệt (Admin, Giám đốc sửa được)
        const withApprovers = (content: ReactNode, docType: "contract" | "budget" | "purchase") => store.mode !== "live" ? content : (
          <div className="pj-with-aside">
            <div className="pj-with-aside-main">{content}</div>
            <ProjectApproversPanel compact title="Người duyệt" projectId={project.id} roles={CHAINS[docType]} canEdit={actor.role === "admin" || approverAccess.isDirector} members={data.members} today={data.today} setNotice={setNotice} />
          </div>
        );
        if (tab === "budget") return withApprovers(<BudgetSheetTab {...tabProps} />, "budget");
        if (tab === "contract") return withApprovers(<ContractTab {...tabProps} />, "contract");
        if (tab === "materials") return <MaterialsTab {...tabProps} />;
        if (tab === "members") return <OrgChartTab {...tabProps} />;
        if (tab === "daily") return <DailyReportTab {...tabProps} />;
        if (tab === "timesheets") return <TimesheetsTab {...tabProps} />;
        if (tab === "checks") return <ChecksTab {...tabProps} />;
        if (tab === "purchases") return withApprovers(<ProjectPurchasesTab {...tabProps} />, "purchase");
        return <ReportsTab {...tabProps} />;
      })()}
      {props.children}
    </section>
  );
}
