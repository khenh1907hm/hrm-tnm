import { addDays } from "../../lib/dates";
import type { Attendance, LaborSettings, OtType, ProjectExpense, ProjectMember, SubcontractPayment, Timesheet, TimesheetCost, TimesheetStatus } from "./types";

/** Một dòng công đã làm phẳng để làm báo cáo. amount = null khi chưa duyệt hoặc người xem không được xem tiền. */
export type WorkRow = {
  timesheetId: string;
  projectId: string;
  workDate: string;
  team: string;
  status: TimesheetStatus;
  employeeId: string;
  attendance: Attendance;
  regularHours: number;
  otHours: number;
  otType: OtType;
  nightHours: number;
  amount: number | null;
  missingRate: boolean;
};

/** Ghép phiếu công với tiền công; bỏ phiếu bị từ chối. */
export function flattenTimesheets(timesheets: readonly Timesheet[], costs: readonly TimesheetCost[]): WorkRow[] {
  const costOf = new Map(costs.map((cost) => [cost.lineId, cost]));
  return timesheets.filter((sheet) => sheet.status !== "rejected").flatMap((sheet) => sheet.lines.map((line): WorkRow => {
    const cost = costOf.get(line.id);
    return {
      timesheetId: sheet.id, projectId: sheet.projectId, workDate: sheet.workDate, team: sheet.team, status: sheet.status,
      employeeId: line.employeeId, attendance: line.attendance, regularHours: line.regularHours, otHours: line.otHours, otType: line.otType, nightHours: line.nightHours,
      amount: cost ? cost.amount : null, missingRate: cost ? cost.rate === null : false,
    };
  }));
}

export type PersonSummary = {
  employeeId: string;
  name: string;
  code: string;
  team: string;
  daysPresent: number;
  daysAbsent: number;
  regularHours: number;
  otHours: number;
  otByType: Record<OtType, number>;
  nightHours: number;
  amount: number;
  /** Có dòng chưa duyệt (tiền chưa chốt). */
  hasPending: boolean;
  missingRate: boolean;
  otOverMonth: boolean;
};

/** PRJ-12: tổng hợp theo người cho một khoảng ngày (báo cáo tuần, tháng). */
export function summarizeByPerson(rows: readonly WorkRow[], members: readonly ProjectMember[], settings?: LaborSettings): PersonSummary[] {
  const byPerson = new Map<string, PersonSummary>();
  for (const row of rows) {
    const member = members.find((item) => item.employeeId === row.employeeId && item.projectId === row.projectId);
    const current = byPerson.get(row.employeeId) ?? {
      employeeId: row.employeeId, name: member?.displayName ?? row.employeeId, code: member?.employeeCode ?? "", team: member?.team ?? row.team,
      daysPresent: 0, daysAbsent: 0, regularHours: 0, otHours: 0, otByType: { weekday: 0, weekly_off: 0, holiday: 0 }, nightHours: 0, amount: 0, hasPending: false, missingRate: false, otOverMonth: false,
    };
    if (row.attendance === "present") current.daysPresent++;
    else if (row.attendance === "absent" || row.attendance === "leave") current.daysAbsent++;
    current.regularHours += row.regularHours;
    current.otHours += row.otHours;
    current.otByType[row.otType] += row.otHours;
    current.nightHours += row.nightHours;
    current.amount += row.amount ?? 0;
    current.hasPending ||= row.status !== "approved";
    current.missingRate ||= row.missingRate;
    byPerson.set(row.employeeId, current);
  }
  const result = [...byPerson.values()];
  if (settings) {
    // Trần 40 giờ tăng ca là theo từng tháng: xét từng tháng có trong khoảng
    for (const person of result) {
      const perMonth = new Map<string, number>();
      for (const row of rows) if (row.employeeId === person.employeeId) perMonth.set(row.workDate.slice(0, 7), (perMonth.get(row.workDate.slice(0, 7)) ?? 0) + row.otHours);
      person.otOverMonth = [...perMonth.values()].some((hours) => hours > settings.maxOtMonth);
    }
  }
  return result.sort((a, b) => a.team.localeCompare(b.team, "vi") || a.name.localeCompare(b.name, "vi"));
}

export const inRange = (rows: readonly WorkRow[], from: string, to: string) => rows.filter((row) => row.workDate >= from && row.workDate <= to);

/** PRJ-12: tổ nào chưa nộp phiếu (chưa có phiếu, còn nháp hoặc bị từ chối chưa gửi lại) và phiếu nào chưa duyệt trong ngày. */
export function dailyStatus(date: string, timesheets: readonly Timesheet[], teams: readonly string[]) {
  const sheets = timesheets.filter((sheet) => sheet.workDate === date);
  const missingTeams = teams.filter((team) => !sheets.some((sheet) => sheet.team === team && (sheet.status === "submitted" || sheet.status === "approved")));
  const pending = sheets.filter((sheet) => sheet.status === "submitted");
  return { missingTeams, pending, sheets };
}

/** Bảng người × ngày (báo cáo tuần): giờ thường và tăng ca mỗi ô. */
export function hoursMatrix(rows: readonly WorkRow[], from: string, days: number) {
  const dates = Array.from({ length: days }, (_, index) => addDays(from, index));
  const cells = new Map<string, { regular: number; ot: number; attendance: Attendance | null }>();
  for (const row of rows) {
    const key = `${row.employeeId}|${row.workDate}`;
    const cell = cells.get(key) ?? { regular: 0, ot: 0, attendance: null };
    cell.regular += row.regularHours;
    cell.ot += row.otHours;
    cell.attendance = cell.attendance === "present" ? "present" : row.attendance;
    cells.set(key, cell);
  }
  return { dates, cell: (employeeId: string, date: string) => cells.get(`${employeeId}|${date}`) ?? null };
}

/** Chi phí lũy kế theo ngày (tiền công đã duyệt + phiếu chi đã duyệt + đợt thanh toán khoán đã duyệt) để vẽ biểu đồ. */
export function cumulativeCost(costs: readonly TimesheetCost[], expenses: readonly ProjectExpense[], payments: readonly SubcontractPayment[], from: string, to: string): { date: string; total: number }[] {
  const perDay = new Map<string, number>();
  const add = (date: string, amount: number) => perDay.set(date, (perDay.get(date) ?? 0) + amount);
  for (const cost of costs) add(cost.workDate, cost.amount);
  for (const expense of expenses) if (expense.status === "approved") add(expense.spentOn, expense.amount);
  for (const payment of payments) if (payment.status !== "requested") add(payment.payDate, payment.amount);
  let running = [...perDay.entries()].filter(([date]) => date < from).reduce((sum, [, amount]) => sum + amount, 0);
  const series: { date: string; total: number }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    running += perDay.get(date) ?? 0;
    series.push({ date, total: running });
  }
  return series;
}
