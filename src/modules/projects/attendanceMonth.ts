import { addDays } from "../../lib/dates";
import { hoursFromCheck, vnClock, type WorkSchedule } from "./attendance";
import { dayKind, monthRange, weekStart } from "./calendar";
import type { Attendance, Holiday, TimesheetStatus } from "./types";

/** Một dòng của hàm my_attendance_month: một ngày, một dự án của chính nhân viên. */
export type MonthRecord = {
  workDate: string;
  projectId: string;
  code: string;
  projectName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  source: "gps" | "explanation" | null;
  sheetStatus: TimesheetStatus | null;
  attendance: Attendance | null;
  regularHours: number | null;
  otHours: number | null;
  schedule: WorkSchedule;
  weeklyOff: number[];
};

/** Tình trạng một ngày trên lịch: đã duyệt, chờ duyệt, mới chấm GPS (chưa có phiếu), vắng, hoặc không có gì. */
export type DayState = "approved" | "pending" | "checked" | "absent" | "none";
export type CalendarDay = { date: string; inMonth: boolean; isToday: boolean; isFuture: boolean; state: DayState; records: (MonthRecord & { inText: string; outText: string; regular: number; ot: number })[] };

/** ATT-01: số giờ của một ngày: lấy theo phiếu công nếu đã có (chỉ huy trưởng có thể đã sửa), chưa có thì tạm tính từ giờ Vào / Ra. */
export function dayHours(record: MonthRecord, holidays: readonly Holiday[]): { regular: number; ot: number } {
  if (record.sheetStatus && record.regularHours !== null) return { regular: record.regularHours, ot: record.otHours ?? 0 };
  if (!record.checkInAt) return { regular: 0, ot: 0 };
  const hours = hoursFromCheck({ workDate: record.workDate, checkInAt: record.checkInAt, checkOutAt: record.checkOutAt }, record.schedule, dayKind(record.workDate, record.weeklyOff, holidays));
  return { regular: hours.regularHours, ot: hours.otHours };
}

function stateOf(records: readonly MonthRecord[]): DayState {
  if (!records.length) return "none";
  if (records.every((record) => record.attendance !== null && record.attendance !== "present")) return "absent";
  if (records.some((record) => record.sheetStatus === "approved")) return "approved";
  if (records.some((record) => record.sheetStatus === "submitted")) return "pending";
  return "checked";
}

/** ATT-01: lịch tháng (tuần bắt đầu thứ Hai) kèm tổng ngày công, giờ thường, tăng ca của tháng. */
export function buildMonthCalendar(month: string, records: readonly MonthRecord[], holidays: readonly Holiday[], today: string) {
  const { from, to } = monthRange(month);
  const days: CalendarDay[] = [];
  for (let date = weekStart(from); date <= to || days.length % 7 !== 0; date = addDays(date, 1)) {
    const mine = records.filter((record) => record.workDate === date).map((record) => ({ ...record, ...(() => { const hours = dayHours(record, holidays); return { regular: hours.regular, ot: hours.ot }; })(), inText: record.checkInAt ? vnClock(record.checkInAt) : "--:--", outText: record.checkOutAt ? vnClock(record.checkOutAt) : "--:--" }));
    days.push({ date, inMonth: date >= from && date <= to, isToday: date === today, isFuture: date > today, state: stateOf(mine), records: mine });
  }
  const inMonth = days.filter((day) => day.inMonth);
  const worked = inMonth.filter((day) => day.state !== "none" && day.state !== "absent");
  return {
    days,
    summary: {
      daysWorked: worked.length,
      regular: inMonth.reduce((sum, day) => sum + day.records.reduce((total, record) => total + record.regular, 0), 0),
      ot: inMonth.reduce((sum, day) => sum + day.records.reduce((total, record) => total + record.ot, 0), 0),
      approved: inMonth.filter((day) => day.state === "approved").length,
      pending: inMonth.filter((day) => day.state === "pending" || day.state === "checked").length,
    },
  };
}
