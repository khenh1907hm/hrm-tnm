/**
 * Báo cáo tuần / tháng của dự án, tổng hợp từ các báo cáo ngày (BC ngày):
 * công = tổng số người hiện diện các ngày; giờ công = công × giờ chuẩn mỗi ngày của dự án; cộng giờ tăng ca;
 * ngày làm việc (theo ngày nghỉ tuần và ngày lễ của dự án) chưa có báo cáo thì liệt kê để nhắc.
 */
import { addDays } from "../../lib/dates";
import { dayKind, monthRange, weekStart, type DayKind } from "./calendar";
import type { DailyReport } from "./dailyReport";
import type { Holiday } from "./types";

export type PeriodKind = "week" | "month";
export type PeriodRange = { from: string; to: string };

export const PERIOD_LABELS: Record<PeriodKind, string> = { week: "Tuần", month: "Tháng" };

/** Tuần (thứ Hai → Chủ nhật) hoặc tháng chứa ngày `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string): PeriodRange {
  if (kind === "month") return monthRange(anchor.slice(0, 7));
  const from = weekStart(anchor);
  return { from, to: addDays(from, 6) };
}

/** Kỳ trước / kỳ sau. */
export function shiftPeriod(kind: PeriodKind, anchor: string, step: -1 | 1): string {
  if (kind === "week") return addDays(weekStart(anchor), 7 * step);
  const [year, month] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
  const next = new Date(Date.UTC(year, month - 1 + step, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function periodTitle(kind: PeriodKind, range: PeriodRange): string {
  const dmy = (iso: string) => iso.split("-").reverse().join("/");
  return kind === "month" ? `Tháng ${range.from.slice(5, 7)}/${range.from.slice(0, 4)}` : `Tuần ${dmy(range.from)} – ${dmy(range.to)}`;
}

export type SummaryDay = { date: string; kind: DayKind; report: DailyReport | null; missing: boolean };
export type TaskSummary = { task: string; days: number; personDays: number; leaders: string[] };
export type DailySummary = PeriodRange & {
  days: SummaryDay[];
  /** Số ngày có báo cáo. */
  reportedDays: number;
  /** Ngày làm việc đã qua (tới hôm nay) mà chưa có báo cáo. */
  missingDates: string[];
  /** Công = tổng số người hiện diện. */
  workdays: number;
  regularHours: number;
  otPersonDays: number;
  otHours: number;
  absentDays: number;
  avgPresent: number;
  maxPresent: number;
  tasks: TaskSummary[];
};

export type SummaryOptions = { weeklyOff: readonly number[]; holidays: readonly Holiday[]; stdHours: number; today: string; /** Ngày bắt đầu dự án: trước ngày này không tính là thiếu báo cáo. */ startDate?: string | null };

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const taskKey = (task: string) => task.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

export function summarizeDailyReports(reports: readonly DailyReport[], range: PeriodRange, options: SummaryOptions): DailySummary {
  const byDate = new Map(reports.filter((report) => report.date >= range.from && report.date <= range.to).map((report) => [report.date, report]));
  const days: SummaryDay[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const kind = dayKind(date, options.weeklyOff, options.holidays);
    const report = byDate.get(date) ?? null;
    days.push({ date, kind, report, missing: !report && kind === "workday" && date <= options.today && (!options.startDate || date >= options.startDate) });
  }
  const reported = days.flatMap((day) => day.report ? [day.report] : []);
  const workdays = reported.reduce((sum, report) => sum + (report.present ?? 0), 0);
  const presentDays = reported.filter((report) => report.present !== null);

  const tasks = new Map<string, TaskSummary>();
  for (const report of reported) {
    for (const task of report.tasks) {
      const key = taskKey(task.task);
      if (!key) continue;
      const entry = tasks.get(key) ?? { task: task.task.trim().replace(/\s+/g, " "), days: 0, personDays: 0, leaders: [] };
      entry.days += 1;
      entry.personDays += task.members.length + (task.leader && !task.members.includes(task.leader) ? 1 : 0);
      if (task.leader && !entry.leaders.includes(task.leader)) entry.leaders.push(task.leader);
      tasks.set(key, entry);
    }
  }

  return {
    ...range,
    days,
    reportedDays: reported.length,
    missingDates: days.filter((day) => day.missing).map((day) => day.date),
    workdays,
    regularHours: round(workdays * options.stdHours),
    otPersonDays: reported.reduce((sum, report) => sum + report.otCount, 0),
    otHours: round(reported.reduce((sum, report) => sum + report.otHours, 0)),
    absentDays: reported.reduce((sum, report) => sum + (report.absent ?? 0), 0),
    avgPresent: presentDays.length ? round(workdays / presentDays.length) : 0,
    maxPresent: presentDays.reduce((max, report) => Math.max(max, report.present ?? 0), 0),
    tasks: [...tasks.values()].sort((a, b) => b.days - a.days || b.personDays - a.personDays || a.task.localeCompare(b.task, "vi")),
  };
}
