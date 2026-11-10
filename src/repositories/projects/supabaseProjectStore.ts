import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ProjectStore } from "../../modules/projects/store";
import type { AttendanceCheck, AttendanceContext, GpsFix } from "../../modules/projects/attendance";
import {
  DEFAULT_LABOR_SETTINGS, type Holiday, type LaborRate, type LaborSettings, type PeriodLock, type Project, type ProjectBudget, type ProjectExpense,
  type ProjectMember, type Subcontract, type SubcontractPayment, type Timesheet, type TimesheetCost, type TimesheetLine,
} from "../../modules/projects/types";

type Row = Record<string, unknown>;
const num = (value: unknown) => value === null || value === undefined ? 0 : Number(value);
const str = (value: unknown) => value === null || value === undefined ? "" : String(value);
const strOrNull = (value: unknown) => value === null || value === undefined ? null : String(value);
/** Cột time của Postgres trả "08:00:00" → "08:00". */
const hhmm = (value: unknown, fallback: string) => typeof value === "string" && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;

/** Đổi lỗi Supabase thành lỗi mang mã nghiệp vụ (hàm RPC ném "MÃ" hoặc "MÃ:chi tiết"). */
function raise(error: PostgrestError, duplicate = "PROJECT_SAVE_FAILED", foreignKey = "PROJECT_SAVE_FAILED"): never {
  if (/^[A-Z][A-Z0-9_]{2,}(:.*)?$/.test(error.message)) throw new Error(error.message);
  if (error.code === "23505") throw new Error(duplicate);
  if (error.code === "23503") throw new Error(foreignKey);
  if (error.code === "42501") throw new Error("FORBIDDEN");
  throw new Error(`PROJECT_SAVE_FAILED:${error.message}`);
}
async function rows<T = Row>(request: PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T[]> {
  const { data, error } = await request;
  if (error) raise(error);
  return (data ?? []) as T[];
}
async function run(request: PromiseLike<{ error: PostgrestError | null }>, duplicate?: string, foreignKey?: string): Promise<void> {
  const { error } = await request;
  if (error) raise(error, duplicate, foreignKey);
}

const projectFromRow = (row: Row): Project => ({
  id: str(row.id), code: str(row.code), name: str(row.name), customerId: strOrNull(row.customer_id), customerName: str(row.customer_name), site: str(row.site),
  pmEmployeeId: strOrNull(row.pm_employee_id), plannedStart: str(row.planned_start), plannedEnd: str(row.planned_end), actualStart: strOrNull(row.actual_start), actualEnd: strOrNull(row.actual_end),
  stdHours: num(row.std_hours), weeklyOff: ((row.weekly_off ?? [0]) as number[]).map(Number), status: row.status as Project["status"], note: str(row.note), updatedAt: str(row.updated_at),
  siteLat: row.site_lat === null || row.site_lat === undefined ? null : Number(row.site_lat), siteLng: row.site_lng === null || row.site_lng === undefined ? null : Number(row.site_lng),
  siteRadiusM: num(row.site_radius_m ?? 300), workStart: hhmm(row.work_start, "08:00"), workEnd: hhmm(row.work_end, "17:00"), lunchStart: hhmm(row.lunch_start, "12:00"), lunchEnd: hhmm(row.lunch_end, "13:00"),
});
const checkFromRow = (row: Row): AttendanceCheck => ({
  id: str(row.id), projectId: str(row.project_id), employeeId: str(row.employee_id), workDate: str(row.work_date), checkInAt: str(row.check_in_at),
  inLat: num(row.in_lat), inLng: num(row.in_lng), inAccuracyM: row.in_accuracy_m === null ? null : num(row.in_accuracy_m), inDistanceM: num(row.in_distance_m), inPhoto: str(row.in_photo),
  checkOutAt: strOrNull(row.check_out_at), outLat: row.out_lat === null ? null : num(row.out_lat), outLng: row.out_lng === null ? null : num(row.out_lng),
  outAccuracyM: row.out_accuracy_m === null ? null : num(row.out_accuracy_m), outDistanceM: row.out_distance_m === null ? null : num(row.out_distance_m), outPhoto: strOrNull(row.out_photo),
});
const PHOTO_BUCKET = "attendance-photos";
const memberFromRow = (row: Row): ProjectMember => ({
  id: str(row.id), projectId: str(row.project_id), employeeId: str(row.employee_id), displayName: str(row.display_name), employeeCode: str(row.employee_code),
  role: row.role as ProjectMember["role"], parentId: strOrNull(row.parent_id), team: str(row.team), subcontractId: strOrNull(row.subcontract_id), joinedOn: str(row.joined_on), leftOn: strOrNull(row.left_on),
});
const lineFromRow = (row: Row): TimesheetLine => ({
  id: str(row.id), employeeId: str(row.employee_id), attendance: row.attendance as TimesheetLine["attendance"], regularHours: num(row.regular_hours), otHours: num(row.ot_hours),
  otType: row.ot_type as TimesheetLine["otType"], nightHours: num(row.night_hours), note: str(row.note),
});
const sheetFromRow = (row: Row): Timesheet => ({
  id: str(row.id), projectId: str(row.project_id), workDate: str(row.work_date), team: str(row.team), status: row.status as Timesheet["status"],
  submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at), rejectReason: str(row.reject_reason), lines: ((row.timesheet_lines ?? []) as Row[]).map(lineFromRow),
});
const rateFromRow = (row: Row): LaborRate => ({ id: str(row.id), employeeId: str(row.employee_id), hourlyRate: num(row.hourly_rate), effectiveFrom: str(row.effective_from), effectiveTo: strOrNull(row.effective_to), note: str(row.note) });
const costFromRow = (row: Row): TimesheetCost => ({
  lineId: str(row.line_id), projectId: str(row.project_id), workDate: str(row.work_date), employeeId: str(row.employee_id), category: row.category as TimesheetCost["category"],
  rate: row.rate === null ? null : num(row.rate), otMultiplier: num(row.ot_multiplier), nightBonus: num(row.night_bonus), amount: num(row.amount),
});
const subcontractFromRow = (row: Row): Subcontract => ({ id: str(row.id), projectId: str(row.project_id), partnerId: strOrNull(row.partner_id), name: str(row.name), mode: row.mode as Subcontract["mode"], contractNo: str(row.contract_no), contractValue: num(row.contract_value), signedOn: strOrNull(row.signed_on), note: str(row.note) });
const paymentFromRow = (row: Row): SubcontractPayment => ({ id: str(row.id), subcontractId: str(row.subcontract_id), payDate: str(row.pay_date), amount: num(row.amount), status: row.status as SubcontractPayment["status"], note: str(row.note) });
const expenseFromRow = (row: Row): ProjectExpense => ({ id: str(row.id), projectId: str(row.project_id), spentOn: str(row.spent_on), category: row.category as ProjectExpense["category"], description: str(row.description), supplier: str(row.supplier), amount: num(row.amount), status: row.status as ProjectExpense["status"] });

const SHEET_COLUMNS = "id, project_id, work_date, team, status, submitted_at, approved_at, reject_reason, timesheet_lines(id, employee_id, attendance, regular_hours, ot_hours, ot_type, night_hours, note)";

/** Store chế độ thật: đọc ghi qua RLS; gửi, duyệt, từ chối, mở lại, tính lại tiền gọi hàm security definer. */
export function createSupabaseProjectStore(client: SupabaseClient): ProjectStore {
  const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await client.rpc(name, args); if (error) raise(error); return data as unknown; };

  /** Tải ảnh rồi gọi check_in / check_out; máy chủ ghi giờ và kiểm tra khoảng cách. */
  const punch = async (fn: "check_in" | "check_out", projectId: string, position: GpsFix, photo: Blob) => {
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) throw new Error("FORBIDDEN");
    const path = `${projectId}/${auth.user.id}/${new Date().toISOString().replace(/[:.]/g, "-")}-${fn === "check_in" ? "in" : "out"}.jpg`;
    const uploaded = await client.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (uploaded.error) throw new Error(`PROJECT_SAVE_FAILED:${uploaded.error.message}`);
    await rpc(fn, { p_project: projectId, p_lat: position.lat, p_lng: position.lng, p_accuracy: position.accuracy, p_photo: path });
  };

  return {
    mode: "live",
    async getFinance(projectId) {
      const { data, error } = await client.from("project_finance").select("capital, note").eq("project_id", projectId).maybeSingle();
      if (error) raise(error);
      const row = data as Row | null;
      return row ? { capital: num(row.capital), note: str(row.note) } : null;
    },
    async saveFinance(projectId, finance) { await run(client.from("project_finance").upsert({ project_id: projectId, capital: finance.capital, note: finance.note })); },
    async myAttendance() {
      const found = (await rpc("my_attendance_context", {}) ?? []) as Row[];
      return found.map((row): AttendanceContext => ({
        projectId: str(row.project_id), code: str(row.code), name: str(row.name), team: str(row.team),
        siteLat: row.site_lat === null ? null : num(row.site_lat), siteLng: row.site_lng === null ? null : num(row.site_lng), siteRadiusM: num(row.site_radius_m),
        weeklyOff: ((row.weekly_off ?? [0]) as number[]).map(Number),
        schedule: { workStart: hhmm(row.work_start, "08:00"), workEnd: hhmm(row.work_end, "17:00"), lunchStart: hhmm(row.lunch_start, "12:00"), lunchEnd: hhmm(row.lunch_end, "13:00"), stdHours: num(row.std_hours) },
        today: row.check_id ? { id: str(row.check_id), checkInAt: str(row.check_in_at), checkOutAt: strOrNull(row.check_out_at), inDistanceM: num(row.in_distance_m), outDistanceM: row.out_distance_m === null ? null : num(row.out_distance_m) } : null,
      }));
    },
    checkIn: (projectId, position, photo) => punch("check_in", projectId, position, photo),
    checkOut: (projectId, position, photo) => punch("check_out", projectId, position, photo),
    async listChecks(projectId, from, to) {
      return (await rows(client.from("attendance_checks").select("*").eq("project_id", projectId).gte("work_date", from).lte("work_date", to).order("check_in_at"))).map(checkFromRow);
    },
    async photoUrl(path) {
      const { data } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
      return data?.signedUrl ?? null;
    },
    async myEmployeeId() {
      const { data: auth } = await client.auth.getUser();
      if (!auth.user) return null;
      const { data } = await client.from("profiles").select("employee_id").eq("id", auth.user.id).maybeSingle();
      return strOrNull((data as Row | null)?.employee_id);
    },

    async listProjects() {
      return (await rows(client.from("projects").select("*").order("planned_start", { ascending: false }))).map(projectFromRow);
    },
    async saveProject(input) {
      const payload = {
        code: input.code.trim(), name: input.name.trim(), customer_id: input.customerId, customer_name: input.customerName.trim(), site: input.site.trim(), pm_employee_id: input.pmEmployeeId,
        planned_start: input.plannedStart, planned_end: input.plannedEnd, actual_start: input.actualStart, actual_end: input.actualEnd, std_hours: input.stdHours, weekly_off: input.weeklyOff,
        status: input.status, note: input.note,
        site_lat: input.siteLat, site_lng: input.siteLng, site_radius_m: input.siteRadiusM,
        work_start: input.workStart, work_end: input.workEnd, lunch_start: input.lunchStart, lunch_end: input.lunchEnd,
      };
      const request = input.id ? client.from("projects").update(payload).eq("id", input.id).select("*").single() : client.from("projects").insert(payload).select("*").single();
      const { data, error } = await request;
      if (error) raise(error, "PROJECT_CODE_DUPLICATE");
      return projectFromRow(data as Row);
    },
    async getBudgets(projectId) {
      return (await rows(client.from("project_budgets").select("*").eq("project_id", projectId))).map((row): ProjectBudget => ({
        category: row.category as ProjectBudget["category"], amount: num(row.amount), warnPct: num(row.warn_pct), plannedHours: row.planned_hours === null ? null : num(row.planned_hours),
      }));
    },
    async saveBudgets(projectId, budgets, reason) {
      const current = await this.getBudgets(projectId) ?? [];
      const changes = budgets.filter((budget) => (current.find((item) => item.category === budget.category)?.amount ?? 0) !== budget.amount);
      await run(client.from("project_budgets").upsert(budgets.map((budget) => ({ project_id: projectId, category: budget.category, amount: budget.amount, warn_pct: budget.warnPct, planned_hours: budget.plannedHours }))));
      if (changes.length) await run(client.from("project_budget_changes").insert(changes.map((budget) => ({ project_id: projectId, category: budget.category, old_amount: current.find((item) => item.category === budget.category)?.amount ?? 0, new_amount: budget.amount, reason }))));
    },

    async listMembers(projectId) { return (await rows(client.from("project_members").select("*").eq("project_id", projectId))).map(memberFromRow); },
    async listMembershipsOf(employeeId) { return (await rows(client.from("project_members").select("*").eq("employee_id", employeeId))).map(memberFromRow); },
    async saveMember(input) {
      const payload = { project_id: input.projectId, employee_id: input.employeeId, display_name: input.displayName, employee_code: input.employeeCode, role: input.role, parent_id: input.parentId, team: input.team.trim(), subcontract_id: input.subcontractId, joined_on: input.joinedOn, left_on: input.leftOn };
      const request = input.id ? client.from("project_members").update(payload).eq("id", input.id).select("*").single() : client.from("project_members").insert(payload).select("*").single();
      const { data, error } = await request;
      if (error) raise(error, "MEMBER_DUPLICATE");
      return memberFromRow(data as Row);
    },
    async removeMember(id) {
      const { data } = await client.from("project_members").select("id").eq("parent_id", id).limit(1);
      if (data?.length) throw new Error("TREE_HAS_CHILDREN");
      await run(client.from("project_members").delete().eq("id", id), undefined, "MEMBER_HAS_TIMESHEETS");
    },
    async listMemberRates(projectId) {
      return (await rows(client.from("project_member_rates").select("member_id, hourly_rate, project_members!inner(project_id)").eq("project_members.project_id", projectId)))
        .map((row) => ({ memberId: str(row.member_id), hourlyRate: num(row.hourly_rate) }));
    },
    async setMemberRate(memberId, hourlyRate) {
      if (hourlyRate === null) await run(client.from("project_member_rates").delete().eq("member_id", memberId));
      else await run(client.from("project_member_rates").upsert({ member_id: memberId, hourly_rate: hourlyRate }));
    },

    async listRates() { return (await rows(client.from("labor_rates").select("*").order("effective_from"))).map(rateFromRow); },
    async upsertRates(rates) {
      await run(client.from("labor_rates").upsert(rates.map((rate) => ({ id: rate.id, employee_id: rate.employeeId, hourly_rate: rate.hourlyRate, effective_from: rate.effectiveFrom, effective_to: rate.effectiveTo, note: rate.note }))), "RATE_OVERLAP");
    },
    async deleteRate(id) { await run(client.from("labor_rates").delete().eq("id", id)); },
    async getSettings() {
      const { data } = await client.from("labor_settings").select("*").eq("id", 1).maybeSingle();
      const row = data as Row | null;
      if (!row) return { ...DEFAULT_LABOR_SETTINGS };
      return { otWeekday: num(row.ot_weekday), otWeeklyOff: num(row.ot_weekly_off), otHoliday: num(row.ot_holiday), nightBonus: num(row.night_bonus), maxHoursDay: num(row.max_hours_day), maxOtMonth: num(row.max_ot_month), maxOtYear: num(row.max_ot_year), backfillDays: num(row.backfill_days) };
    },
    async saveSettings(settings: LaborSettings) {
      await run(client.from("labor_settings").update({ ot_weekday: settings.otWeekday, ot_weekly_off: settings.otWeeklyOff, ot_holiday: settings.otHoliday, night_bonus: settings.nightBonus, max_hours_day: settings.maxHoursDay, max_ot_month: settings.maxOtMonth, max_ot_year: settings.maxOtYear, backfill_days: settings.backfillDays, updated_at: new Date().toISOString() }).eq("id", 1));
    },
    async listHolidays() { return (await rows(client.from("holidays").select("*").order("day"))).map((row): Holiday => ({ day: str(row.day), name: str(row.name) })); },
    async saveHoliday(holiday) { await run(client.from("holidays").upsert({ day: holiday.day, name: holiday.name })); },
    async deleteHoliday(day) { await run(client.from("holidays").delete().eq("day", day)); },

    async listTimesheets(projectId, from, to) {
      return (await rows(client.from("timesheets").select(SHEET_COLUMNS).eq("project_id", projectId).gte("work_date", from).lte("work_date", to).order("work_date"))).map(sheetFromRow);
    },
    async saveTimesheet(sheet) {
      // Phiếu đã có (theo dự án + ngày + tổ) thì dùng lại id; trạng thái không gửi lên (chỉ đổi qua hàm RPC)
      const { data: found } = await client.from("timesheets").select("id").eq("project_id", sheet.projectId).eq("work_date", sheet.workDate).eq("team", sheet.team).maybeSingle();
      const id = str((found as Row | null)?.id) || sheet.id;
      if (found) await run(client.from("timesheets").update({ reject_reason: sheet.rejectReason }).eq("id", id));
      else await run(client.from("timesheets").insert({ id, project_id: sheet.projectId, work_date: sheet.workDate, team: sheet.team, status: "draft" }), "TS_DUPLICATE");
      const keep = sheet.lines.map((line) => line.id).filter(Boolean);
      await run(keep.length
        ? client.from("timesheet_lines").delete().eq("timesheet_id", id).not("id", "in", `(${keep.join(",")})`)
        : client.from("timesheet_lines").delete().eq("timesheet_id", id));
      if (sheet.lines.length) {
        await run(client.from("timesheet_lines").upsert(sheet.lines.map((line) => ({
          id: line.id || crypto.randomUUID(), timesheet_id: id, employee_id: line.employeeId, attendance: line.attendance, regular_hours: line.regularHours, ot_hours: line.otHours, ot_type: line.otType, night_hours: line.nightHours, note: line.note,
        }))), "TS_DUPLICATE");
      }
      const { data, error } = await client.from("timesheets").select(SHEET_COLUMNS).eq("id", id).single();
      if (error) raise(error);
      return sheetFromRow(data as Row);
    },
    async deleteTimesheet(id) { await run(client.from("timesheets").delete().eq("id", id)); },
    async submitTimesheet(id) { await rpc("submit_timesheet", { p_id: id }); },
    async approveTimesheet(id) { await rpc("approve_timesheet", { p_id: id }); },
    async rejectTimesheet(id, reason) { await rpc("reject_timesheet", { p_id: id, p_reason: reason }); },
    async reopenTimesheet(id, reason) { await rpc("reopen_timesheet", { p_id: id, p_reason: reason }); },
    async otherHours(employeeIds, from, to, excludeTimesheetId) {
      if (!employeeIds.length) return [];
      const found = await rows(client.from("timesheet_lines").select("employee_id, regular_hours, ot_hours, timesheets!inner(id, project_id, work_date, status)")
        .in("employee_id", [...employeeIds]).gte("timesheets.work_date", from).lte("timesheets.work_date", to).in("timesheets.status", ["submitted", "approved"]).neq("timesheets.id", excludeTimesheetId));
      return found.map((row) => {
        const sheet = row.timesheets as Row;
        return { employeeId: str(row.employee_id), projectId: str(sheet.project_id), workDate: str(sheet.work_date), regularHours: num(row.regular_hours), otHours: num(row.ot_hours) };
      });
    },
    async listCosts(projectId, from, to) {
      return (await rows(client.from("timesheet_costs").select("*").eq("project_id", projectId).gte("work_date", from).lte("work_date", to))).map(costFromRow);
    },
    async recalcCosts(projectId, from, to) { return Number(await rpc("recalc_project_costs", { p_project: projectId, p_from: from, p_to: to })); },

    async listSubcontracts(projectId) { return (await rows(client.from("subcontracts").select("*").eq("project_id", projectId).order("created_at"))).map(subcontractFromRow); },
    async saveSubcontract(input) {
      const payload = { project_id: input.projectId, partner_id: input.partnerId, name: input.name.trim(), mode: input.mode, contract_no: input.contractNo, contract_value: input.contractValue, signed_on: input.signedOn, note: input.note };
      const { data, error } = input.id ? await client.from("subcontracts").update(payload).eq("id", input.id).select("*").single() : await client.from("subcontracts").insert(payload).select("*").single();
      if (error) raise(error);
      return subcontractFromRow(data as Row);
    },
    async deleteSubcontract(id) { await run(client.from("subcontracts").delete().eq("id", id)); },
    async listPayments(projectId) {
      return (await rows(client.from("subcontract_payments").select("*, subcontracts!inner(project_id)").eq("subcontracts.project_id", projectId).order("pay_date"))).map(paymentFromRow);
    },
    async savePayment(input) {
      const payload = { subcontract_id: input.subcontractId, pay_date: input.payDate, amount: input.amount, status: input.status, note: input.note };
      await run(input.id ? client.from("subcontract_payments").update(payload).eq("id", input.id) : client.from("subcontract_payments").insert(payload));
    },
    async deletePayment(id) { await run(client.from("subcontract_payments").delete().eq("id", id)); },
    async listExpenses(projectId) { return (await rows(client.from("project_expenses").select("*").eq("project_id", projectId).order("spent_on"))).map(expenseFromRow); },
    async saveExpense(input) {
      const payload = { project_id: input.projectId, spent_on: input.spentOn, category: input.category, description: input.description.trim(), supplier: input.supplier.trim(), amount: input.amount, status: input.status };
      await run(input.id ? client.from("project_expenses").update(payload).eq("id", input.id) : client.from("project_expenses").insert(payload));
    },
    async deleteExpense(id) { await run(client.from("project_expenses").delete().eq("id", id)); },

    async listLocks(projectId) { return (await rows(client.from("period_locks").select("*").eq("project_id", projectId))).map((row): PeriodLock => ({ projectId: str(row.project_id), month: str(row.month), lockedAt: str(row.locked_at) })); },
    async lockMonth(projectId, month) { await run(client.from("period_locks").upsert({ project_id: projectId, month })); },
    async unlockMonth(projectId, month, reason) { await rpc("unlock_period", { p_project: projectId, p_month: month, p_reason: reason }); },
  };
}
