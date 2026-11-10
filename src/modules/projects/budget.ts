import { addDays } from "../../lib/dates";
import { BUDGET_CATEGORIES, type BudgetCategory, type ProjectBudget, type ProjectExpense, type Subcontract, type SubcontractPayment, type TimesheetCost } from "./types";

export type BudgetLevel = "ok" | "warn" | "over";

export type BudgetLine = {
  category: BudgetCategory;
  budget: number;
  used: number;
  pending: number;
  committed: number;
  remaining: number;
  /** Đã dùng / ngân sách (0–∞); ngân sách 0 mà đã chi thì coi là vượt. */
  pct: number;
  forecast: number;
  level: BudgetLevel;
  forecastOver: boolean;
  warnPct: number;
};

export type BudgetInput = {
  budgets: readonly ProjectBudget[];
  costs: readonly TimesheetCost[];
  expenses: readonly ProjectExpense[];
  subcontracts: readonly Subcontract[];
  payments: readonly SubcontractPayment[];
  today: string;
  /** Số ngày làm việc còn lại tới ngày kết thúc dự kiến. */
  remainingWorkdays: number;
  /** Chi phí của phiếu đã gửi nhưng chưa duyệt (nếu ước tính được). */
  pendingCosts?: Partial<Record<BudgetCategory, number>>;
};

const FORECAST_WINDOW_DAYS = 14;

/** Chi phí trung bình mỗi ngày có công trong 14 ngày gần nhất (tính cả hôm nay). */
export function averageDailyCost(costs: readonly TimesheetCost[], today: string): number {
  const from = addDays(today, -(FORECAST_WINDOW_DAYS - 1));
  const recent = costs.filter((cost) => cost.workDate >= from && cost.workDate <= today);
  const days = new Set(recent.map((cost) => cost.workDate)).size;
  return days ? recent.reduce((sum, cost) => sum + cost.amount, 0) / days : 0;
}

export function levelOf(pct: number, warnPct: number): BudgetLevel {
  return pct >= 1 ? "over" : pct * 100 >= warnPct ? "warn" : "ok";
}

/**
 * PRJ-09 / PRJ-10: Đã dùng, chờ duyệt, cam kết, còn lại, % sử dụng và dự báo cho từng khoản (spec mục 4.4).
 * Đã dùng: nhân công và thầu phụ theo người = tiền công đã duyệt; thầu phụ khoán gọn = các đợt đã duyệt hoặc đã chi;
 * vật tư, chi phí khác = phiếu chi đã duyệt.
 * Cam kết: phần còn lại của hợp đồng khoán gọn.
 * Dự báo: đã dùng + cam kết + (với khoản có chấm công) chi phí trung bình mỗi ngày × số ngày làm việc còn lại.
 */
export function budgetSummary(input: BudgetInput): { lines: BudgetLine[]; total: BudgetLine } {
  const lumpSum = input.subcontracts.filter((item) => item.mode === "lump_sum");
  const paidOf = (subcontractId: string) => input.payments.filter((payment) => payment.subcontractId === subcontractId && payment.status !== "requested").reduce((sum, payment) => sum + payment.amount, 0);
  const requestedOf = (subcontractId: string) => input.payments.filter((payment) => payment.subcontractId === subcontractId && payment.status === "requested").reduce((sum, payment) => sum + payment.amount, 0);

  const lines = BUDGET_CATEGORIES.map((category): BudgetLine => {
    const budget = input.budgets.find((item) => item.category === category);
    const amount = budget?.amount ?? 0;
    const warnPct = budget?.warnPct ?? 80;
    let used = 0;
    let pending = input.pendingCosts?.[category] ?? 0;
    let committed = 0;
    let trend = 0;
    if (category === "labor" || category === "subcontract") {
      const costs = input.costs.filter((cost) => cost.category === category);
      used = costs.reduce((sum, cost) => sum + cost.amount, 0);
      trend = averageDailyCost(costs, input.today) * Math.max(0, input.remainingWorkdays);
    }
    if (category === "subcontract") {
      for (const contract of lumpSum) {
        const paid = paidOf(contract.id);
        used += paid;
        pending += requestedOf(contract.id);
        committed += Math.max(0, contract.contractValue - paid);
      }
    }
    if (category === "material" || category === "other") {
      const expenses = input.expenses.filter((expense) => expense.category === category);
      used = expenses.filter((expense) => expense.status === "approved").reduce((sum, expense) => sum + expense.amount, 0);
      pending += expenses.filter((expense) => expense.status === "draft").reduce((sum, expense) => sum + expense.amount, 0);
    }
    const pct = amount > 0 ? used / amount : used > 0 ? Infinity : 0;
    const forecast = Math.round(used + committed + trend);
    return { category, budget: amount, used, pending, committed, remaining: amount - used, pct, forecast, level: levelOf(pct, warnPct), forecastOver: forecast > amount, warnPct };
  });

  const sum = (key: "budget" | "used" | "pending" | "committed" | "forecast") => lines.reduce((total, line) => total + line[key], 0);
  const budget = sum("budget");
  const used = sum("used");
  const pct = budget > 0 ? used / budget : used > 0 ? Infinity : 0;
  const forecast = sum("forecast");
  return { lines, total: { category: "labor", budget, used, pending: sum("pending"), committed: sum("committed"), remaining: budget - used, pct, forecast, level: levelOf(pct, 80), forecastOver: forecast > budget, warnPct: 80 } };
}

/** Phần trăm hiển thị: 0,825 → "82,5%"; vô hạn (ngân sách 0 đã chi) → "Không có ngân sách". */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "Không có ngân sách";
  return `${(pct * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}
