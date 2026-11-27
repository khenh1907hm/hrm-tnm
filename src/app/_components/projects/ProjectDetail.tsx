"use client";
import { SettingsTab } from "./SettingsTab";
import { SkeletonDetail } from "../Skeleton";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, MapPin, Pencil } from "lucide-react";
import { isLink, siteMapUrl } from "../../../lib/mapsLink";
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
import { ChecksTab } from "./ChecksTab";
import { OrgChartTab } from "./OrgChartTab";
import { ApprovalTreePanel } from "./ApprovalTreePanel";
import { AsideSlotContext } from "./asideSlot";
import { CONTRACT_STATE_UI, myAccount, projectApprovers, projectContractStates, type ContractState } from "../accountApi";
import { BudgetSheetTab } from "./BudgetSheetTab";
import { ContractTab } from "./ContractTab";
import { DailyReportTab } from "./DailyReportTab";
import { OverviewTab } from "./OverviewTab";
import { errorMessage, viewerFor, type EmployeeSource, type ProjectViewer } from "./projectShared";
import { formatDateVn } from "./ProjectsPage";
import { ReportsTab } from "./ReportsTab";
import { TimesheetsTab } from "./TimesheetsTab";
import { ToolChecksTab } from "./ToolChecksTab";
import { ExplanatoryTab } from "./ExplanatoryTab";
import { ProjectProcurement, type ProcurementStage } from "../purchases/ProjectProcurement";

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

type Tab = "overview" | "contract" | "budget" | "explanatory" | "materials" | "podraft" | "purchases" | "payments" | "members" | "daily" | "timesheets" | "checks" | "tools" | "reports" | "settings";
/** Theo thứ tự quy trình vận hành: Confirmed Contract → Budget → Material Request → PO Draft → PO → Request for Payment → thi công. */
const TABS: readonly [Tab, string, string?][] = [
  ["overview", "Overview"], ["contract", "Confirmed Contract", "P-COST-01"], ["budget", "Budget Sheet", "P-COST-03"], ["explanatory", "Explanatory Report", "P-COST-05"],
  ["materials", "Purchasing", "Material Request → PO Draft → Purchase Order → Request for Payment"],
  ["members", "Org Chart & Members"], ["timesheets", "Timesheets"], ["checks", "GPS Check-in"], ["tools", "Tool Check"], ["reports", "Reports"], ["settings", "Settings"],
];
/** Giai đoạn mua hàng: một tab "Purchasing", bên trong là sub-nav 4 bước. */
const PROCUREMENT = new Set<string>(["materials", "podraft", "purchases", "payments"]);
/** Mở thẳng một mục qua đường dẫn ?muc=ngan-sach (từ "Chờ tôi ký", thông báo). */
export const TAB_SLUGS: Record<Tab, string> = {
  overview: "tong-quan", contract: "hop-dong", budget: "ngan-sach", explanatory: "bao-cao-giai-thich", materials: "yeu-cau-vat-tu", podraft: "don-nhap", purchases: "dat-hang", payments: "de-nghi-thanh-toan", members: "so-do", daily: "bao-cao-ngay",
  timesheets: "cham-cong", checks: "cham-cong-gps", tools: "kiem-tra-dung-cu", reports: "bao-cao", settings: "cai-dat",
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
  // Ô đầu khung bên phải: đơn hàng đang mở đưa chuỗi ký vào đây
  const [asideSlot, setAsideSlot] = useState<HTMLDivElement | null>(null);

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
  const visibleTabs = TABS.filter(([key]) => (key !== "budget" && key !== "contract" && key !== "explanatory") || viewer?.canSeeMoney || signsHere || actor.role === "admin");
  /** Daily Report nằm trong tab Reports (đường dẫn cũ ?muc=bao-cao-ngay vẫn mở đúng). */
  const canDaily = Boolean(viewer?.isLead || viewer?.canEditProject);
  const duration = data ? projectDuration(project, data.holidays, data.today) : null;

  const mapUrl = siteMapUrl(project);
  return (
    <section className="pj-page">
      <div>
        <button type="button" className="back-button" onClick={props.onBack}><ArrowLeft className="ico" size={16} aria-hidden="true" /> Danh sách dự án</button>
        <div className="page-head">
          <div>
            <span className="pj-code">{project.code} · {PROJECT_STATUS_LABELS[project.status]}</span>
            {stateUi && <span className={`cc-pill cc-${stateUi.tone}`} style={{ marginLeft: 8 }}>{stateUi.label}</span>}
            <h1>{project.name}</h1>
            <p>{[project.customerName, isLink(project.site) ? "" : project.site].filter(Boolean).join(" · ")}
              {mapUrl && <>{project.customerName || (project.site && !isLink(project.site)) ? " · " : ""}<a href={mapUrl} target="_blank" rel="noreferrer"><MapPin className="ico" size={14} aria-hidden="true" /> Bản đồ công trường</a></>}</p>
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
        {visibleTabs.map(([key, label, form]) => <button key={key} type="button" role="tab" aria-selected={tab === key || (key === "reports" && tab === "daily") || (key === "materials" && PROCUREMENT.has(tab))} aria-label={label} title={form ? `${label} · ${form}` : undefined} onClick={() => setTab(key === "materials" && PROCUREMENT.has(tab) ? tab : key)}>{label}</button>)}
      </div>
      {!data || !viewer ? <SkeletonDetail label="Đang tải dữ liệu dự án…" /> : (() => {
        const tabProps: TabProps = { store, data, viewer, actor, employees: props.employees, reload: async () => { await reload(); props.onChanged(); }, setNotice };
        if (tab === "overview") return <OverviewTab {...tabProps} />;
        // Confirm Contract, Ngân sách, Đặt hàng: bên phải là khung người duyệt (Admin, Giám đốc sửa được)
        const withApprovers = (content: ReactNode, docType: "contract" | "budget" | "explanatory" | "material" | "purchase" | "payment") => store.mode !== "live" ? content : (
          <div className="pj-with-aside">
            <div className="pj-with-aside-main"><AsideSlotContext.Provider value={asideSlot}>{content}</AsideSlotContext.Provider></div>
            <div className="pj-aside-col">
              <div className="pj-aside-slot" ref={setAsideSlot} />
              <ApprovalTreePanel key={docType} projectId={project.id} docType={docType} canEdit={actor.role === "admin" || approverAccess.isDirector} members={data.members} today={data.today} setNotice={setNotice} />
            </div>
          </div>
        );
        if (tab === "budget") return withApprovers(<BudgetSheetTab {...tabProps} />, "budget");
        if (tab === "contract") return withApprovers(<ContractTab {...tabProps} />, "contract");
        if (tab === "members") return <OrgChartTab {...tabProps} />;
        if (tab === "timesheets") return <TimesheetsTab {...tabProps} />;
        if (tab === "checks") return <ChecksTab {...tabProps} />;
        if (tab === "tools") return <ToolChecksTab {...tabProps} />;
        if (tab === "settings") return <SettingsTab {...tabProps} onEditInfo={props.onEdit} />;
        if (tab === "explanatory") return withApprovers(<ExplanatoryTab {...tabProps} />, "explanatory");
        if (PROCUREMENT.has(tab)) {
          const stage = tab as ProcurementStage;
          // Thanh quy trình đầy đủ; khung Người duyệt theo loại phiếu của khối đang chọn
          return withApprovers(<ProjectProcurement {...tabProps} stage={stage} onStage={setTab} />, stage === "materials" ? "material" : stage === "payments" ? "payment" : "purchase");
        }
        return (
          <>
            {canDaily && <div className="pj-subtabs" role="tablist" aria-label="Loại báo cáo">
              <button type="button" role="tab" aria-selected={tab === "daily"} onClick={() => setTab("daily")}>Daily Report</button>
              <button type="button" role="tab" aria-selected={tab !== "daily"} onClick={() => setTab("reports")}>Timesheet Report</button>
            </div>}
            {tab === "daily" && canDaily ? <DailyReportTab {...tabProps} /> : <ReportsTab {...tabProps} />}
          </>
        );
      })()}
      {props.children}
    </section>
  );
}
