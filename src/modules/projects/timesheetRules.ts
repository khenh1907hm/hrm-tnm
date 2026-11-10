import { addDays } from "../../lib/dates";
import { issue, type Issue } from "../../lib/result";
import { monthOf } from "./calendar";
import { activeOn } from "./tree";
import type { LaborSettings, Project, ProjectMember, Timesheet, TimesheetLine, TimesheetStatus } from "./types";

/** Giờ công của một người ở phiếu khác (dự án khác hoặc tổ khác) dùng để kiểm tra theo ngày, tháng, năm. */
export type OtherHours = { employeeId: string; projectId: string; workDate: string; regularHours: number; otHours: number };

export type TimesheetCheckContext = {
  project: Pick<Project, "status" | "plannedStart" | "plannedEnd" | "actualEnd">;
  timesheet: Pick<Timesheet, "id" | "projectId" | "workDate" | "lines">;
  members: readonly ProjectMember[];
  settings: LaborSettings;
  today: string;
  /** PM, CHT hoặc Admin: được nhập lùi quá hạn. */
  isLead: boolean;
  lockedMonths: readonly string[];
  /** Dòng công của các phiếu khác đã gửi hoặc đã duyệt, của những người có trong phiếu này. */
  otherHours: readonly OtherHours[];
  /** Mã nhân sự thiếu đơn giá tại ngày làm việc (chỉ có khi người xem được tiền). */
  missingRate?: ReadonlySet<string>;
  /** Mã nhân sự có thẻ an toàn bắt buộc đã hết hạn tại ngày làm việc. */
  safetyExpired?: ReadonlySet<string>;
};

const isHalfStep = (value: number) => Number.isFinite(value) && value >= 0 && value <= 24 && Math.round(value * 2) === value * 2;

/** PRJ-07: giờ nhập theo bước 0,5 trong khoảng 0–24; có mặt phải có giờ, vắng thì không có giờ (TS-09). */
export function lineIssues(line: TimesheetLine): Issue[] {
  const issues: Issue[] = [];
  if (![line.regularHours, line.otHours, line.nightHours].every(isHalfStep)) issues.push(issue("TS_HOURS_STEP", line.employeeId));
  const total = line.regularHours + line.otHours;
  if (line.attendance === "present" ? total <= 0 : total + line.nightHours > 0) issues.push(issue("TS_ATTENDANCE_HOURS", line.employeeId));
  return issues;
}

/**
 * PRJ-08: kiểm tra phiếu công trước khi gửi và khi duyệt (spec mục 4.3).
 * Chặn: dự án không thi công, ngoài thời gian dự án, ngày tương lai, tháng đã khóa, quá hạn nhập lùi, phiếu trống,
 * ngoài khoảng thành viên, sai giờ, quá 24 giờ/ngày trên mọi dự án.
 * Cảnh báo: làm 2 dự án cùng ngày, quá 12 giờ/ngày, quá trần tăng ca tháng/năm, thiếu đơn giá, thẻ an toàn hết hạn.
 */
export function checkTimesheet(ctx: TimesheetCheckContext): Issue[] {
  const { project, timesheet, settings } = ctx;
  const date = timesheet.workDate;
  const issues: Issue[] = [];
  if (project.status !== "active") issues.push(issue("TS_PROJECT_NOT_ACTIVE"));
  const lastDay = project.actualEnd ?? (project.plannedEnd > ctx.today ? project.plannedEnd : ctx.today);
  if (date < project.plannedStart || date > lastDay) issues.push(issue("TS_OUTSIDE_PROJECT"));
  if (date > ctx.today) issues.push(issue("TS_FUTURE_DATE"));
  if (ctx.lockedMonths.includes(monthOf(date))) issues.push(issue("TS_PERIOD_LOCKED"));
  if (!ctx.isLead && date < addDays(ctx.today, -settings.backfillDays)) issues.push(issue("TS_BACKFILL_LIMIT", undefined, "error", { days: settings.backfillDays }));
  if (!timesheet.lines.length) issues.push(issue("TS_EMPTY"));

  const year = date.slice(0, 4);
  for (const line of timesheet.lines) {
    const member = ctx.members.find((item) => item.projectId === timesheet.projectId && item.employeeId === line.employeeId);
    const name = member?.displayName || line.employeeId;
    const params = { name };
    if (!member || !activeOn(member, date)) issues.push(issue("TS_OUTSIDE_MEMBERSHIP", line.employeeId, "error", params));
    issues.push(...lineIssues(line).map((item) => ({ ...item, params })));
    if (line.attendance !== "present") continue;

    const others = ctx.otherHours.filter((other) => other.employeeId === line.employeeId);
    const sameDay = others.filter((other) => other.workDate === date);
    const dayTotal = line.regularHours + line.otHours + sameDay.reduce((sum, other) => sum + other.regularHours + other.otHours, 0);
    if (dayTotal > 24) issues.push(issue("TS_DAY_OVER_24", line.employeeId, "error", params));
    else if (dayTotal > settings.maxHoursDay) issues.push(issue("TS_OVER_DAY_LIMIT", line.employeeId, "warning", { ...params, hours: dayTotal, limit: settings.maxHoursDay }));
    if (sameDay.some((other) => other.projectId !== timesheet.projectId)) issues.push(issue("TS_MULTI_PROJECT", line.employeeId, "warning", params));

    const monthOt = line.otHours + others.filter((other) => monthOf(other.workDate) === monthOf(date)).reduce((sum, other) => sum + other.otHours, 0);
    if (monthOt > settings.maxOtMonth) issues.push(issue("TS_OT_MONTH_LIMIT", line.employeeId, "warning", { ...params, hours: monthOt, limit: settings.maxOtMonth }));
    const yearOt = line.otHours + others.filter((other) => other.workDate.startsWith(year)).reduce((sum, other) => sum + other.otHours, 0);
    if (yearOt > settings.maxOtYear) issues.push(issue("TS_OT_YEAR_LIMIT", line.employeeId, "warning", { ...params, hours: yearOt, limit: settings.maxOtYear }));
    if (ctx.missingRate?.has(line.employeeId)) issues.push(issue("TS_MISSING_RATE", line.employeeId, "warning", params));
    if (ctx.safetyExpired?.has(line.employeeId)) issues.push(issue("TS_SAFETY_EXPIRED", line.employeeId, "warning", params));
  }
  return issues;
}

export const blocking = (issues: readonly Issue[]) => issues.filter((item) => item.severity === "error");

export type TimesheetActor = "leader" | "lead" | "admin";

/** PRJ-13: ai sửa được phiếu ở trạng thái nào. Tổ trưởng: nháp và bị từ chối; CHT/PM: thêm chờ duyệt; đã duyệt thì không ai sửa (Admin phải mở lại). */
export function canEditTimesheet(status: TimesheetStatus, actor: TimesheetActor, locked: boolean): boolean {
  if (locked) return false;
  if (status === "draft" || status === "rejected") return true;
  return status === "submitted" && actor !== "leader";
}

/** PRJ-13: các bước chuyển trạng thái hợp lệ. */
export function canTransition(from: TimesheetStatus, to: TimesheetStatus, actor: TimesheetActor): boolean {
  if (to === "submitted") return from === "draft" || from === "rejected" || (from === "approved" && actor === "admin");
  if (to === "approved" || to === "rejected") return from === "submitted" && actor !== "leader";
  return false;
}
