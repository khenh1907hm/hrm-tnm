import type { ProjectExpense, SubcontractPayment, TimesheetCost } from "./types";

export type Granularity = "day" | "month" | "year";
export type PeriodCost = { period: string; labor: number; subcontract: number; material: number; other: number; total: number; cumulative: number; capitalLeft: number };

const keyOf = (date: string, granularity: Granularity) => granularity === "day" ? date : granularity === "month" ? date.slice(0, 7) : date.slice(0, 4);

/**
 * PRJ-16: chi phí đã duyệt theo ngày / tháng / năm, lũy kế và vốn còn lại sau mỗi kỳ.
 * Nhân công, thầu phụ theo người = tiền công đã duyệt (theo ngày làm việc); thầu phụ khoán = đợt đã duyệt hoặc đã chi (theo ngày trả);
 * vật tư, chi phí khác = phiếu chi đã duyệt (theo ngày chi). Vốn còn lại = vốn − lũy kế (âm là đã vượt vốn).
 */
export function costsByPeriod(input: { capital: number; costs: readonly TimesheetCost[]; expenses: readonly ProjectExpense[]; payments: readonly SubcontractPayment[]; granularity: Granularity }): PeriodCost[] {
  const rows = new Map<string, PeriodCost>();
  const row = (date: string) => {
    const period = keyOf(date, input.granularity);
    let current = rows.get(period);
    if (!current) { current = { period, labor: 0, subcontract: 0, material: 0, other: 0, total: 0, cumulative: 0, capitalLeft: 0 }; rows.set(period, current); }
    return current;
  };
  for (const cost of input.costs) row(cost.workDate)[cost.category] += cost.amount;
  for (const payment of input.payments) if (payment.status !== "requested") row(payment.payDate).subcontract += payment.amount;
  for (const expense of input.expenses) if (expense.status === "approved") row(expense.spentOn)[expense.category] += expense.amount;
  let running = 0;
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period)).map((item) => {
    const total = item.labor + item.subcontract + item.material + item.other;
    running += total;
    return { ...item, total, cumulative: running, capitalLeft: input.capital - running };
  });
}

/** Nhãn kỳ: 2026-11-09 → 09/11/2026, 2026-11 → 11/2026, 2026 → 2026. */
export const periodLabel = (period: string) => period.length === 10 ? period.split("-").reverse().join("/") : period.length === 7 ? `${period.slice(5)}/${period.slice(0, 4)}` : period;
