import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { createMemoryProjectStore } from "../../repositories/projects/memoryProjectStore";
import { createMemoryPurchaseStore } from "../../repositories/purchases/memoryPurchaseStore";
import { buildSteps, canSign, currentStep, emptyDepartments, holdsRole, nextWorkday, type ApprovalStep } from "./approval";
import { budgetCheck, categoryAmounts, DEFAULT_COST_CODES, groupOf, sheetIssue, sheetTotals } from "./budget";

const header = { confirmation: "confirmed" as const, exchangeRate: 25_000, quoteNo: "TNM Q-0201-2025", offerPrice: 1_200_000_000, contractValue: 1_100_000_000, note: "" };
const line = (code: string, budget: number, nett = budget) => ({ code, nett, budget, supplier: "", contingency: 0, remark: "" });

describe("procurement phase A", () => {
  it("PRC_01 cost codes follow P-COST-03: four groups by first digit, every code unique", () => {
    expect(new Set(DEFAULT_COST_CODES.map((item) => item.code)).size).toBe(DEFAULT_COST_CODES.length);
    expect(DEFAULT_COST_CODES.every((item) => groupOf(item.code) === item.group)).toBe(true);
    expect(DEFAULT_COST_CODES.find((item) => item.code === "175")?.name).toBe("SWITCH BOARD/PANEL");
    expect([groupOf("111"), groupOf("231"), groupOf("351"), groupOf("490"), groupOf("999")]).toEqual([100, 200, 300, 400, null]);
  });

  it("PRC_02 order confirmation box: D = B + C, E = A − D (example from the P-CC-07 form)", () => {
    expect(budgetCheck("175", "S25001-01-01", 100_000_000, 65_000_000, 40_000_000)).toEqual({ code: "175", sheetNumber: "S25001-01-01", a: 100_000_000, b: 65_000_000, c: 40_000_000, d: 105_000_000, e: -5_000_000, over: true });
    expect(budgetCheck("175", "S25001-01-01", 100_000_000, 50_000_000, 15_000_000)).toMatchObject({ d: 65_000_000, e: 35_000_000, over: false });
  });

  it("PRC_03 project orders need a budget code from an approved budget and cannot exceed it", async () => {
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects: createMemoryProjectStore({ clock }) });
    const order = (budgetCode: string | null, unitPrice: number) => store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode, title: "Tủ điện", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice }] });
    await expect(store.submit((await order(null, 1_000)).id)).rejects.toThrow("PO_BUDGET_CODE_REQUIRED");
    await expect(store.submit((await order("175", 1_000)).id)).rejects.toThrow("PO_NO_BUDGET");
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, header, [line("175", 100_000_000)]);
    await store.submitBudgetSheet(sheet);
    for (const step of await store.listSteps("budget", sheet)) if (step.result === "pending") await store.sign(step.id, true, "");
    const first = await order("175", 65_000_000);
    await store.submit(first.id);
    for (const step of (await store.listSteps("purchase", first.id)).filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, "");
    expect(await store.checkBudget("proj-1", "175", null)).toEqual({ sheetNumber: "DA-01", a: 100_000_000, b: 65_000_000 });
    await expect(store.submit((await order("175", 40_000_000)).id)).rejects.toThrow("PO_OVER_BUDGET");
    const ok = await order("175", 35_000_000);
    await store.submit(ok.id);
    expect(await store.getOrder(ok.id)).toMatchObject({ status: "submitted", usesChain: true, budgetA: 100_000_000, budgetB: 65_000_000 });
  });

  it("PRC_04 signing chain: fixed order with target workdays, empty departments skipped, only the current holder signs, a return stops the chain", () => {
    expect(nextWorkday("2026-11-14")).toBe("2026-11-16");
    const departments = { ...emptyDepartments(), leader: ["E1"], technical: ["E2"], accounting: ["E3"] };
    let n = 0;
    const steps = buildSteps("purchase", "po", "2026-11-13", departments, () => `s${++n}`);
    expect(steps.map((step) => [step.role, step.result, step.targetDate])).toEqual([
      ["pic", "pending", "2026-11-14"], ["technical", "pending", "2026-11-16"], ["material", "skipped", "2026-11-16"],
      ["accounting", "pending", "2026-11-17"], ["leader", "pending", "2026-11-18"], ["admin_office", "skipped", "2026-11-18"],
    ]);
    const signer = (employeeId: string, isPicOfDoc = false) => ({ employeeId, isAdmin: false, isPicOfDoc, departments });
    expect(currentStep(steps)?.role).toBe("pic");
    expect(canSign(steps, signer("E2"))).toBe(false);
    expect(canSign(steps, signer("E9", true))).toBe(true);
    const afterPic: ApprovalStep[] = steps.map((step) => step.role === "pic" ? { ...step, result: "signed" } : step);
    expect(canSign(afterPic, signer("E2"))).toBe(true);
    expect(holdsRole("leader", { ...signer("E9"), isPurchaseApprover: true })).toBe(true);
    expect(holdsRole("accounting", { ...signer("E9"), isAdmin: true })).toBe(true);
    const returned: ApprovalStep[] = afterPic.map((step) => step.role === "technical" ? { ...step, result: "returned" } : step);
    expect(currentStep(returned)).toBeNull();
  });

  it("PRC_05 budget sheet totals and profits use the P-COST-03 formulas; amounts roll up to the four old budget categories", () => {
    const sheet = { ...header, lines: [line("165", 300_000_000, 280_000_000), line("221", 200_000_000, 190_000_000), line("351", 250_000_000, 240_000_000), line("417", 50_000_000, 40_000_000)] };
    const totals = sheetTotals(sheet);
    expect([totals.nett, totals.direct, totals.total]).toEqual([750_000_000, 750_000_000, 800_000_000]);
    expect([totals.quoteProfit, totals.profit, totals.profitA, totals.profitB]).toEqual([450_000_000, 350_000_000, 350_000_000, 300_000_000]);
    expect(totals.profitBPct).toBeCloseTo(300 / 1100);
    expect(categoryAmounts(sheet.lines)).toEqual({ material: 300_000_000, labor: 200_000_000, subcontract: 250_000_000, other: 50_000_000 });
    expect(sheetIssue({ ...sheet, lines: [line("175", 1), line("175", 2)] }, false)).toBe("BUDGET_DUPLICATE_CODE");
    expect(sheetIssue({ ...sheet, lines: [line("999", 1)] }, false)).toBe("BUDGET_UNKNOWN_CODE");
    expect(sheetIssue({ ...sheet, lines: [] }, true)).toBe("BUDGET_EMPTY");
  });

  it("PRC_06 a new budget revision copies the last one, only one may be open, and approving it supersedes the previous one and updates the project budgets", async () => {
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const projects = createMemoryProjectStore({ clock });
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects });
    const approve = async (id: string) => { await store.submitBudgetSheet(id); for (const step of await store.listSteps("budget", id)) if (step.result === "pending") await store.sign(step.id, true, ""); };
    const first = await store.newBudgetSheet("proj-1");
    await expect(store.newBudgetSheet("proj-1")).rejects.toThrow("BUDGET_OPEN_EXISTS");
    await store.saveBudgetSheet(first, header, [line("175", 100_000_000), line("221", 40_000_000)]);
    await approve(first);
    const second = await store.newBudgetSheet("proj-1");
    expect((await store.listBudgetSheets("proj-1")).find((sheet) => sheet.id === second)?.lines.map((item) => item.code)).toEqual(["175", "221"]);
    await store.saveBudgetSheet(second, header, [line("175", 120_000_000), line("221", 40_000_000)]);
    await approve(second);
    expect((await store.listBudgetSheets("proj-1")).map((sheet) => [sheet.number, sheet.status])).toEqual([["DA-02", "approved"], ["DA-01", "superseded"]]);
    expect((await projects.getBudgets("proj-1"))?.map((budget) => [budget.category, budget.amount])).toEqual(expect.arrayContaining([["material", 120_000_000], ["labor", 40_000_000]]));
  });
});
