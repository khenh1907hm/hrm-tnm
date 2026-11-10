import { todayVN, systemClock, type Clock } from "../../lib/clock";
import { computeTimesheetCosts } from "../../modules/projects/cost";
import { monthOf } from "../../modules/projects/calendar";
import type { ProjectStore } from "../../modules/projects/store";
import { blocking, checkTimesheet } from "../../modules/projects/timesheetRules";
import { distanceM, withinSite, type AttendanceCheck, type GpsFix } from "../../modules/projects/attendance";
import {
  DEFAULT_LABOR_SETTINGS, DEFAULT_SITE_SETTINGS, type ProjectFinance, type Holiday, type LaborRate, type LaborSettings, type MemberRate, type PeriodLock, type Project, type ProjectBudget,
  type ProjectExpense, type ProjectMember, type Subcontract, type SubcontractPayment, type Timesheet, type TimesheetCost,
} from "../../modules/projects/types";

export type ProjectData = {
  projects: Project[];
  budgets: (ProjectBudget & { projectId: string })[];
  members: ProjectMember[];
  memberRates: MemberRate[];
  rates: LaborRate[];
  settings: LaborSettings;
  holidays: Holiday[];
  timesheets: Timesheet[];
  costs: TimesheetCost[];
  subcontracts: Subcontract[];
  payments: SubcontractPayment[];
  expenses: ProjectExpense[];
  locks: PeriodLock[];
  finances: (ProjectFinance & { projectId: string })[];
  checks: AttendanceCheck[];
};

export const emptyProjectData = (): ProjectData => ({
  projects: [], budgets: [], members: [], memberRates: [], rates: [], settings: { ...DEFAULT_LABOR_SETTINGS }, holidays: [],
  timesheets: [], costs: [], subcontracts: [], payments: [], expenses: [], locks: [], finances: [], checks: [],
});

const fail = (code: string, detail = ""): never => { throw new Error(detail ? `${code}:${detail}` : code); };
const clone = <T>(value: T): T => structuredClone(value);

/**
 * Store chế độ demo: toàn bộ dữ liệu trong bộ nhớ, ghi kèm vào localStorage để tải lại trang vẫn còn.
 * Người dùng demo luôn là Admin, nên mọi quyền đều mở (quyền thật nằm ở RLS Supabase).
 */
export function createMemoryProjectStore(options: { initial?: ProjectData; persistKey?: string; clock?: Clock; newId?: () => string } = {}): ProjectStore & { snapshot(): ProjectData } {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  let data: ProjectData = options.initial ? clone(options.initial) : emptyProjectData();
  if (options.persistKey && !options.initial) {
    try { const raw = window.localStorage.getItem(options.persistKey); if (raw) data = { ...emptyProjectData(), ...JSON.parse(raw) as ProjectData }; } catch { /* không đọc được: dùng dữ liệu rỗng */ }
  }
  // Dữ liệu demo cũ chưa có giờ làm, tọa độ công trường
  data.projects = data.projects.map((project) => ({ ...DEFAULT_SITE_SETTINGS, ...project }));
  // Ảnh chấm công demo chỉ giữ trong phiên (không ghi localStorage)
  const photos = new Map<string, string>();
  let actingAs: string | null = null;
  const persist = () => {
    if (!options.persistKey) return;
    try { window.localStorage.setItem(options.persistKey, JSON.stringify(data)); } catch { /* trình duyệt chặn lưu: vẫn dùng được trong phiên */ }
  };
  const today = () => todayVN(clock);
  const now = () => clock.now();
  const sheetOf = (id: string) => data.timesheets.find((sheet) => sheet.id === id) ?? fail("TS_NOT_FOUND");
  /** Giống private.validate_position: thành viên còn trong dự án, dự án có tọa độ, trong bán kính. */
  const validatePosition = (projectId: string, position: GpsFix): number => {
    if (!actingAs) fail("CHECKIN_NO_EMPLOYEE");
    const project = data.projects.find((item) => item.id === projectId && item.status === "active") ?? fail("TS_PROJECT_NOT_ACTIVE");
    if (!data.members.some((member) => member.projectId === projectId && member.employeeId === actingAs && member.joinedOn <= today() && (member.leftOn === null || member.leftOn >= today()))) fail("TS_OUTSIDE_MEMBERSHIP");
    if (project.siteLat === null || project.siteLng === null) fail("CHECKIN_NO_SITE");
    const distance = distanceM(project.siteLat!, project.siteLng!, position.lat, position.lng);
    if (!withinSite(distance, project.siteRadiusM)) fail("CHECKIN_OUT_OF_RANGE", String(distance));
    return distance;
  };
  const isLocked = (projectId: string, date: string) => data.locks.some((lock) => lock.projectId === projectId && lock.month === monthOf(date));

  return {
    mode: "demo",
    snapshot: () => clone(data),
    async myEmployeeId() { return actingAs; },
    actAs(employeeId) { actingAs = employeeId; },

    async getFinance(projectId) { const found = data.finances.find((item) => item.projectId === projectId); return found ? { capital: found.capital, note: found.note } : null; },
    async saveFinance(projectId, finance) { data.finances = [...data.finances.filter((item) => item.projectId !== projectId), { ...finance, projectId }]; persist(); },

    async myAttendance() {
      if (!actingAs) return [];
      return data.members.filter((member) => member.employeeId === actingAs && member.joinedOn <= today() && (member.leftOn === null || member.leftOn >= today())).flatMap((member) => {
        const project = data.projects.find((item) => item.id === member.projectId && item.status === "active");
        if (!project) return [];
        const check = data.checks.find((item) => item.projectId === project.id && item.employeeId === actingAs && item.workDate === today());
        return [{
          projectId: project.id, code: project.code, name: project.name, team: member.team, siteLat: project.siteLat, siteLng: project.siteLng, siteRadiusM: project.siteRadiusM, weeklyOff: project.weeklyOff,
          schedule: { workStart: project.workStart, workEnd: project.workEnd, lunchStart: project.lunchStart, lunchEnd: project.lunchEnd, stdHours: project.stdHours },
          today: check ? { id: check.id, checkInAt: check.checkInAt, checkOutAt: check.checkOutAt, inDistanceM: check.inDistanceM, outDistanceM: check.outDistanceM } : null,
        }];
      });
    },
    async checkIn(projectId, position, photo) {
      const distance = validatePosition(projectId, position);
      if (data.checks.some((item) => item.projectId === projectId && item.employeeId === actingAs && item.workDate === today())) fail("CHECKIN_ALREADY");
      const path = `${projectId}/demo/${today()}-${actingAs}-in.jpg`;
      photos.set(path, URL.createObjectURL(photo));
      data.checks.push({ id: newId(), projectId, employeeId: actingAs!, workDate: today(), checkInAt: now(), inLat: position.lat, inLng: position.lng, inAccuracyM: position.accuracy, inDistanceM: distance, inPhoto: path, checkOutAt: null, outLat: null, outLng: null, outAccuracyM: null, outDistanceM: null, outPhoto: null });
      persist();
    },
    async checkOut(projectId, position, photo) {
      const distance = validatePosition(projectId, position);
      const check = data.checks.find((item) => item.projectId === projectId && item.employeeId === actingAs && item.workDate === today() && item.checkOutAt === null) ?? fail("CHECKOUT_WITHOUT_CHECKIN");
      const path = `${projectId}/demo/${today()}-${actingAs}-out.jpg`;
      photos.set(path, URL.createObjectURL(photo));
      Object.assign(check, { checkOutAt: now(), outLat: position.lat, outLng: position.lng, outAccuracyM: position.accuracy, outDistanceM: distance, outPhoto: path });
      persist();
    },
    async listChecks(projectId, from, to) { return clone(data.checks.filter((item) => item.projectId === projectId && item.workDate >= from && item.workDate <= to)); },
    async photoUrl(path) { return photos.get(path) ?? null; },

    async listProjects() { return clone(data.projects).sort((a, b) => b.plannedStart.localeCompare(a.plannedStart) || a.code.localeCompare(b.code)); },
    async saveProject(input) {
      const code = input.code.trim().toLowerCase();
      if (data.projects.some((project) => project.id !== input.id && project.code.trim().toLowerCase() === code)) fail("PROJECT_CODE_DUPLICATE");
      const saved: Project = { ...input, id: input.id ?? newId(), updatedAt: now() } as Project;
      data.projects = [...data.projects.filter((project) => project.id !== saved.id), saved];
      persist();
      return clone(saved);
    },
    async getBudgets(projectId) { return clone(data.budgets.filter((budget) => budget.projectId === projectId).map((budget) => ({ category: budget.category, amount: budget.amount, warnPct: budget.warnPct, plannedHours: budget.plannedHours }))); },
    async saveBudgets(projectId, budgets) {
      data.budgets = [...data.budgets.filter((budget) => budget.projectId !== projectId), ...budgets.map((budget) => ({ ...budget, projectId }))];
      persist();
    },

    async listMembers(projectId) { return clone(data.members.filter((member) => member.projectId === projectId)); },
    async listMembershipsOf(employeeId) { return clone(data.members.filter((member) => member.employeeId === employeeId)); },
    async saveMember(input) {
      if (data.members.some((member) => member.id !== input.id && member.projectId === input.projectId && member.employeeId === input.employeeId)) fail("MEMBER_DUPLICATE");
      const saved: ProjectMember = { ...input, id: input.id ?? newId() };
      data.members = [...data.members.filter((member) => member.id !== saved.id), saved];
      persist();
      return clone(saved);
    },
    async removeMember(id) {
      if (data.members.some((member) => member.parentId === id)) fail("TREE_HAS_CHILDREN");
      const member = data.members.find((item) => item.id === id);
      if (member && data.timesheets.some((sheet) => sheet.projectId === member.projectId && sheet.lines.some((line) => line.employeeId === member.employeeId))) fail("MEMBER_HAS_TIMESHEETS");
      data.members = data.members.filter((item) => item.id !== id);
      data.memberRates = data.memberRates.filter((rate) => rate.memberId !== id);
      persist();
    },
    async listMemberRates(projectId) {
      const ids = new Set(data.members.filter((member) => member.projectId === projectId).map((member) => member.id));
      return clone(data.memberRates.filter((rate) => ids.has(rate.memberId)));
    },
    async setMemberRate(memberId, hourlyRate) {
      data.memberRates = [...data.memberRates.filter((rate) => rate.memberId !== memberId), ...(hourlyRate === null ? [] : [{ memberId, hourlyRate }])];
      persist();
    },

    async listRates() { return clone(data.rates); },
    async upsertRates(rates) {
      const ids = new Set(rates.map((rate) => rate.id));
      data.rates = [...data.rates.filter((rate) => !ids.has(rate.id)), ...clone(rates)];
      persist();
    },
    async deleteRate(id) { data.rates = data.rates.filter((rate) => rate.id !== id); persist(); },
    async getSettings() { return clone(data.settings); },
    async saveSettings(settings) { data.settings = clone(settings); persist(); },
    async listHolidays() { return clone(data.holidays).sort((a, b) => a.day.localeCompare(b.day)); },
    async saveHoliday(holiday) { data.holidays = [...data.holidays.filter((item) => item.day !== holiday.day), holiday]; persist(); },
    async deleteHoliday(day) { data.holidays = data.holidays.filter((item) => item.day !== day); persist(); },

    async listTimesheets(projectId, from, to) {
      return clone(data.timesheets.filter((sheet) => sheet.projectId === projectId && sheet.workDate >= from && sheet.workDate <= to));
    },
    async saveTimesheet(sheet) {
      const existing = data.timesheets.find((item) => item.id === sheet.id)
        ?? data.timesheets.find((item) => item.projectId === sheet.projectId && item.workDate === sheet.workDate && item.team === sheet.team);
      if (existing && (existing.status === "approved")) fail("TS_NOT_EDITABLE");
      if (isLocked(sheet.projectId, sheet.workDate)) fail("TS_PERIOD_LOCKED");
      const saved: Timesheet = { ...clone(sheet), id: existing?.id ?? sheet.id, status: existing?.status ?? "draft", lines: sheet.lines.map((line) => ({ ...line, id: line.id || newId() })) };
      data.timesheets = [...data.timesheets.filter((item) => item.id !== saved.id), saved];
      persist();
      return clone(saved);
    },
    async deleteTimesheet(id) {
      if (sheetOf(id).status !== "draft") fail("TS_NOT_EDITABLE");
      data.timesheets = data.timesheets.filter((sheet) => sheet.id !== id);
      persist();
    },
    async submitTimesheet(id) {
      const sheet = sheetOf(id);
      if (sheet.status !== "draft" && sheet.status !== "rejected") fail("TS_NOT_EDITABLE");
      const project = data.projects.find((item) => item.id === sheet.projectId) ?? fail("PROJECT_NOT_FOUND");
      const employeeIds = new Set(sheet.lines.map((line) => line.employeeId));
      const otherHours = data.timesheets.filter((other) => other.id !== id && (other.status === "submitted" || other.status === "approved")).flatMap((other) => other.lines
        .filter((line) => employeeIds.has(line.employeeId))
        .map((line) => ({ employeeId: line.employeeId, projectId: other.projectId, workDate: other.workDate, regularHours: line.regularHours, otHours: line.otHours })));
      const errors = blocking(checkTimesheet({
        project, timesheet: sheet, members: data.members, settings: data.settings, today: today(), isLead: true,
        lockedMonths: data.locks.filter((lock) => lock.projectId === sheet.projectId).map((lock) => lock.month), otherHours,
      }));
      if (errors[0]) fail(errors[0].code, String(errors[0].params?.name ?? ""));
      sheet.status = "submitted"; sheet.submittedAt = now(); sheet.rejectReason = "";
      persist();
    },
    async approveTimesheet(id) {
      const sheet = sheetOf(id);
      if (sheet.status !== "submitted") fail("TS_NOT_SUBMITTED");
      if (isLocked(sheet.projectId, sheet.workDate)) fail("TS_PERIOD_LOCKED");
      const lineIds = new Set(sheet.lines.map((line) => line.id));
      data.costs = [...data.costs.filter((cost) => !lineIds.has(cost.lineId)), ...computeTimesheetCosts(sheet, data.members, data.rates, data.memberRates, data.settings)];
      sheet.status = "approved"; sheet.approvedAt = now();
      persist();
    },
    async rejectTimesheet(id, reason) {
      if (reason.trim().length < 3) fail("TS_REJECT_REASON");
      const sheet = sheetOf(id);
      if (sheet.status !== "submitted") fail("TS_NOT_SUBMITTED");
      sheet.status = "rejected"; sheet.rejectReason = reason.trim();
      persist();
    },
    async reopenTimesheet(id, reason) {
      if (reason.trim().length < 5) fail("TS_REOPEN_REASON");
      const sheet = sheetOf(id);
      if (sheet.status !== "approved") fail("TS_NOT_APPROVED");
      if (isLocked(sheet.projectId, sheet.workDate)) fail("TS_PERIOD_LOCKED");
      const lineIds = new Set(sheet.lines.map((line) => line.id));
      data.costs = data.costs.filter((cost) => !lineIds.has(cost.lineId));
      sheet.status = "submitted"; sheet.approvedAt = null;
      persist();
    },
    async otherHours(employeeIds, from, to, excludeTimesheetId) {
      const wanted = new Set(employeeIds);
      return data.timesheets.filter((sheet) => sheet.id !== excludeTimesheetId && (sheet.status === "submitted" || sheet.status === "approved") && sheet.workDate >= from && sheet.workDate <= to)
        .flatMap((sheet) => sheet.lines.filter((line) => wanted.has(line.employeeId)).map((line) => ({ employeeId: line.employeeId, projectId: sheet.projectId, workDate: sheet.workDate, regularHours: line.regularHours, otHours: line.otHours })));
    },
    async listCosts(projectId, from, to) { return clone(data.costs.filter((cost) => cost.projectId === projectId && cost.workDate >= from && cost.workDate <= to)); },
    async recalcCosts(projectId, from, to) {
      let count = 0;
      for (const sheet of data.timesheets) {
        if (sheet.projectId !== projectId || sheet.status !== "approved" || sheet.workDate < from || sheet.workDate > to || isLocked(projectId, sheet.workDate)) continue;
        const lineIds = new Set(sheet.lines.map((line) => line.id));
        data.costs = [...data.costs.filter((cost) => !lineIds.has(cost.lineId)), ...computeTimesheetCosts(sheet, data.members, data.rates, data.memberRates, data.settings)];
        count++;
      }
      persist();
      return count;
    },

    async listSubcontracts(projectId) { return clone(data.subcontracts.filter((item) => item.projectId === projectId)); },
    async saveSubcontract(input) {
      const saved: Subcontract = { ...input, id: input.id ?? newId() };
      data.subcontracts = [...data.subcontracts.filter((item) => item.id !== saved.id), saved];
      persist();
      return clone(saved);
    },
    async deleteSubcontract(id) {
      data.subcontracts = data.subcontracts.filter((item) => item.id !== id);
      data.payments = data.payments.filter((item) => item.subcontractId !== id);
      data.members = data.members.map((member) => member.subcontractId === id ? { ...member, subcontractId: null } : member);
      persist();
    },
    async listPayments(projectId) {
      const ids = new Set(data.subcontracts.filter((item) => item.projectId === projectId).map((item) => item.id));
      return clone(data.payments.filter((item) => ids.has(item.subcontractId)));
    },
    async savePayment(input) { const saved = { ...input, id: input.id ?? newId() }; data.payments = [...data.payments.filter((item) => item.id !== saved.id), saved]; persist(); },
    async deletePayment(id) { data.payments = data.payments.filter((item) => item.id !== id); persist(); },
    async listExpenses(projectId) { return clone(data.expenses.filter((item) => item.projectId === projectId)); },
    async saveExpense(input) { const saved = { ...input, id: input.id ?? newId() }; data.expenses = [...data.expenses.filter((item) => item.id !== saved.id), saved]; persist(); },
    async deleteExpense(id) { data.expenses = data.expenses.filter((item) => item.id !== id); persist(); },

    async listLocks(projectId) { return clone(data.locks.filter((lock) => lock.projectId === projectId)); },
    async lockMonth(projectId, month) {
      if (!data.locks.some((lock) => lock.projectId === projectId && lock.month === month)) data.locks.push({ projectId, month, lockedAt: now() });
      persist();
    },
    async unlockMonth(projectId, month, reason) {
      if (reason.trim().length < 5) fail("PERIOD_UNLOCK_REASON");
      data.locks = data.locks.filter((lock) => !(lock.projectId === projectId && lock.month === month));
      persist();
    },
  };
}
