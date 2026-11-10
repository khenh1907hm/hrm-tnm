import { addDays, diffDays } from "../../lib/dates";
import type { Holiday, OtType, Project, TimesheetLine } from "./types";

export type DayKind = "workday" | "weekly_off" | "holiday";

/** Thứ trong tuần của ngày YYYY-MM-DD: 0 = Chủ nhật … 6 = Thứ bảy (không phụ thuộc múi giờ máy). */
export function weekdayOf(date: string): number {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
}

/** PRJ-01: ngày lễ ưu tiên hơn ngày nghỉ tuần; còn lại là ngày làm việc. */
export function dayKind(date: string, weeklyOff: readonly number[], holidays: readonly Holiday[]): DayKind {
  if (holidays.some((holiday) => holiday.day === date)) return "holiday";
  return weeklyOff.includes(weekdayOf(date)) ? "weekly_off" : "workday";
}

export const otTypeOf = (kind: DayKind): OtType => kind === "workday" ? "weekday" : kind;

/**
 * PRJ-02: dòng công mặc định khi mở phiếu.
 * Ngày làm việc: có mặt, giờ thường = giờ chuẩn. Ngày nghỉ tuần / ngày lễ: giờ thường 0, mọi giờ làm được nhập là tăng ca đúng loại
 * (người lao động đi làm ngày nghỉ thì cả ngày là làm thêm giờ).
 */
export function defaultLine(employeeId: string, kind: DayKind, stdHours: number, id: string): TimesheetLine {
  return kind === "workday"
    ? { id, employeeId, attendance: "present", regularHours: stdHours, otHours: 0, otType: "weekday", nightHours: 0, note: "" }
    : { id, employeeId, attendance: "present", regularHours: 0, otHours: stdHours, otType: otTypeOf(kind), nightHours: 0, note: "" };
}

/** PRJ-11: số ngày lịch và số ngày làm việc (trừ ngày nghỉ tuần, ngày lễ) từ from tới to, tính cả hai đầu. */
export function countDays(from: string, to: string, weeklyOff: readonly number[], holidays: readonly Holiday[]): { calendar: number; working: number } {
  if (to < from) return { calendar: 0, working: 0 };
  const calendar = diffDays(from, to) + 1;
  let working = 0;
  for (let index = 0; index < calendar; index++) if (dayKind(addDays(from, index), weeklyOff, holidays) === "workday") working++;
  return { calendar, working };
}

/** Tổng thời gian thực hiện dự kiến và thực tế (thực tế tính tới hôm nay nếu chưa kết thúc). */
export function projectDuration(project: Pick<Project, "plannedStart" | "plannedEnd" | "actualStart" | "actualEnd" | "weeklyOff">, holidays: readonly Holiday[], today: string) {
  const planned = countDays(project.plannedStart, project.plannedEnd, project.weeklyOff, holidays);
  const actual = project.actualStart ? countDays(project.actualStart, project.actualEnd ?? today, project.weeklyOff, holidays) : null;
  const remaining = today <= project.plannedEnd ? countDays(today > project.plannedStart ? addDays(today, 1) : project.plannedStart, project.plannedEnd, project.weeklyOff, holidays) : { calendar: 0, working: 0 };
  return { planned, actual, remaining };
}

/** Ngày đầu tuần (thứ Hai) chứa ngày đã cho. */
export function weekStart(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export const monthOf = (date: string) => date.slice(0, 7);

/** Ngày đầu và ngày cuối của tháng YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export const weekdayShort = (date: string) => WEEKDAY_SHORT[weekdayOf(date)]!;
