import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { createMemoryProjectStore } from "../../repositories/projects/memoryProjectStore";
import { createMemoryPurchaseStore } from "../../repositories/purchases/memoryPurchaseStore";
import { buildSteps, canSign, currentStep, emptyDepartments, holdsRole, nextWorkday, type ApprovalStep } from "./approval";
import { orderBlock, paymentIssue, poBlock, stepStates } from "./flow";
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
    const order = (budgetCode: string | null, unitPrice: number) => store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode, advanceRequired: false, advancePct: null, prepayRequired: false, title: "Tủ điện", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice }] });
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

  it("PRC_04 signing chain: fixed order with target days from the form (not one day per step), empty departments skipped, only the current holder signs, a return stops the chain", () => {
    expect(nextWorkday("2026-11-14")).toBe("2026-11-16");
    const departments = { ...emptyDepartments(), leader: ["E1"], technical: ["E2"], accounting: ["E3"] };
    let n = 0;
    const steps = buildSteps("purchase", "po", "2026-11-13", departments, () => `s${++n}`);
    // P-CC-07: Phụ trách, Kỹ thuật ngày 1; Vật tư ngày 2; Kế toán, Lãnh đạo, Hành chánh ngày 3 (gửi thứ Sáu 13/11, bỏ Chủ nhật)
    expect(steps.map((step) => [step.role, step.result, step.targetDate])).toEqual([
      ["pic", "pending", "2026-11-14"], ["technical", "pending", "2026-11-14"], ["material", "skipped", "2026-11-16"],
      ["accounting", "pending", "2026-11-17"], ["leader", "pending", "2026-11-17"], ["admin_office", "skipped", "2026-11-17"],
    ]);
    expect(buildSteps("payment", "rfp", "2026-11-13", departments, () => "x").map((step) => step.targetDate)).toEqual(["2026-11-14", "2026-11-14", "2026-11-14", "2026-11-16"]);
    expect(buildSteps("budget", "b", "2026-11-13", departments, () => "x").map((step) => step.targetDate)).toEqual(["2026-11-14", "2026-11-14", "2026-11-16"]);
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

  it("PRC_30 the progress bar branches on the supplier terms: no advance / no prepayment steps are skipped, a required advance is the current step after approval", () => {
    const none = stepStates({ status: "approved", advanceRequired: false, prepayRequired: false }, []);
    expect([none.advance, none.prepayment, none.ordered]).toEqual(["skipped", "skipped", "todo"]);
    const advance = stepStates({ status: "approved", advanceRequired: true, prepayRequired: true }, []);
    expect([advance.advance, advance.prepayment]).toEqual(["current", "todo"]);
    expect(stepStates({ status: "ordered", advanceRequired: true, prepayRequired: false }, [{ kind: "advance", status: "paid" }]).advance).toBe("done");
  });

  it("PRC_31 when the supplier needs an advance, ordering waits until the advance is paid; an advance cannot be requested when the supplier does not need one", async () => {
    expect(orderBlock({ advanceRequired: false }, [])).toBeNull();
    expect(orderBlock({ advanceRequired: true }, [{ kind: "advance", status: "approved" }])).toBe("PO_ADVANCE_NOT_PAID");
    expect(orderBlock({ advanceRequired: true }, [{ kind: "advance", status: "paid" }])).toBeNull();
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects: createMemoryProjectStore({ clock }) });
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, header, [line("175", 100_000_000)]);
    await store.submitBudgetSheet(sheet);
    for (const step of await store.listSteps("budget", sheet)) if (step.result === "pending") await store.sign(step.id, true, "");
    const order = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "175", advanceRequired: false, advancePct: null, prepayRequired: false, title: "Tủ", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice: 10_000_000 }] });
    await store.submit(order.id);
    for (const step of (await store.listSteps("purchase", order.id)).filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, "");
    await expect(store.requestPayment(order.id, { kind: "advance", amount: 1_000_000, vatAmount: 0, invoiceNo: "", invoiceDate: null, payee: "", note: "" })).rejects.toThrow("PO_PAYMENT_NOT_NEEDED");
    await store.issuePo(order.id, "NCC A", "");
    await store.supplierAccept(order.id, "");
    await store.markOrdered(order.id, "NCC A", "", null, "");
    expect((await store.getOrder(order.id))?.status).toBe("ordered");
  });

  it("PRC_32 a payment request needs an invoice number (except advances) and the total before tax cannot exceed the order value", () => {
    const order = { totalEstimate: 40_000_000, totalActual: null };
    const paid = [{ amount: 12_000_000, status: "paid" as const }, { amount: 5_000_000, status: "rejected" as const }];
    expect(paymentIssue(order, paid, { kind: "prepayment", amount: 10_000_000, vatAmount: 800_000, invoiceNo: "" })).toBe("PO_INVOICE_REQUIRED");
    expect(paymentIssue(order, paid, { kind: "advance", amount: 10_000_000, vatAmount: 0, invoiceNo: "" })).toBeNull();
    expect(paymentIssue(order, paid, { kind: "final", amount: 28_000_001, vatAmount: 0, invoiceNo: "HD9" })).toBe("PO_PAY_OVER");
    expect(paymentIssue(order, paid, { kind: "final", amount: 28_000_000, vatAmount: 2_240_000, invoiceNo: "HD9" })).toBeNull();
    expect(paymentIssue(order, paid, { kind: "final", amount: 0, vatAmount: 0, invoiceNo: "HD9" })).toBe("PO_BAD_AMOUNT");
  });

  it("PRC_33 project payment requests are signed by person in charge, technical, material and leadership before accounting pays; a return rejects the request", async () => {
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects: createMemoryProjectStore({ clock }) });
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, header, [line("175", 100_000_000)]);
    await store.submitBudgetSheet(sheet);
    for (const step of await store.listSteps("budget", sheet)) if (step.result === "pending") await store.sign(step.id, true, "");
    const order = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "175", advanceRequired: true, advancePct: 30, prepayRequired: false, title: "Tủ", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice: 10_000_000 }] });
    await store.submit(order.id);
    for (const step of (await store.listSteps("purchase", order.id)).filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, "");
    await store.issuePo(order.id, "NCC A", "");
    await store.supplierAccept(order.id, "");
    await store.requestPayment(order.id, { kind: "advance", amount: 3_000_000, vatAmount: 0, invoiceNo: "", invoiceDate: null, payee: "NCC A", note: "" });
    const [first] = await store.listPayments(order.id);
    expect((await store.listSteps("payment", first!.id)).map((step) => step.role)).toEqual(["pic", "technical", "material", "leader"]);
    expect((await store.myApprovals()).find((item) => item.docType === "payment")).toMatchObject({ orderId: order.id, amount: 3_000_000 });
    const [pic] = await store.listSteps("payment", first!.id);
    await store.sign(pic!.id, false, "Sai số tiền");
    expect((await store.listPayments(order.id))[0]?.status).toBe("rejected");
    await store.requestPayment(order.id, { kind: "advance", amount: 3_000_000, vatAmount: 0, invoiceNo: "", invoiceDate: null, payee: "NCC A", note: "" });
    const second = (await store.listPayments(order.id)).find((payment) => payment.status === "requested")!;
    for (const step of await store.listSteps("payment", second.id)) await store.sign(step.id, true, "");
    await store.pay(second.id, "Chuyển khoản", "");
    await store.markOrdered(order.id, "NCC A", "", null, "");
    expect((await store.getOrder(order.id))?.status).toBe("ordered");
  });

  it("PRC_34 project orders: administration issues the PO (numbered per project, signs the administration step) and the supplier must sign it back before advance or ordering", async () => {
    expect(poBlock({ usesChain: false })).toBeNull();
    expect(poBlock({ usesChain: true, poIssuedAt: null })).toBe("PO_NOT_ISSUED");
    expect(poBlock({ usesChain: true, poIssuedAt: "x", supplierAcceptedAt: null })).toBe("PO_NOT_ACCEPTED");
    expect(stepStates({ status: "approved", usesChain: true, poIssuedAt: null }, []).po).toBe("current");
    expect(stepStates({ status: "approved", usesChain: false }, []).po).toBe("skipped");
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects: createMemoryProjectStore({ clock }) });
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, header, [line("175", 100_000_000)]);
    await store.submitBudgetSheet(sheet);
    for (const step of await store.listSteps("budget", sheet)) if (step.result === "pending") await store.sign(step.id, true, "");
    const order = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "175", advanceRequired: false, advancePct: null, prepayRequired: false, title: "Tủ", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice: 10_000_000 }] });
    await store.submit(order.id);
    for (const step of (await store.listSteps("purchase", order.id)).filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, "");
    await expect(store.supplierAccept(order.id, "")).rejects.toThrow("PO_BAD_STATUS");
    await store.issuePo(order.id, "Công ty ABC", "Ông A");
    expect(await store.getOrder(order.id)).toMatchObject({ poNo: "PO-DA-001", supplier: "Công ty ABC", supplierAcceptedAt: null });
    expect((await store.listSteps("purchase", order.id)).find((step) => step.role === "admin_office")?.result).toBe("signed");
    await expect(store.markOrdered(order.id, "Công ty ABC", "", null, "")).rejects.toThrow("PO_NOT_ACCEPTED");
    await store.supplierAccept(order.id, "Bản ký lưu ở HC");
    await store.markOrdered(order.id, "Công ty ABC", "", null, "");
    expect((await store.getOrder(order.id))?.status).toBe("ordered");
  });

  it("PRC_35 receiving a project order needs a delivery record number signed by both parties", async () => {
    let seq = 0;
    const clock = fixedClock("2026-11-12T09:00:00+07:00");
    const store = createMemoryPurchaseStore({ clock, newId: () => `id${++seq}`, projects: createMemoryProjectStore({ clock }) });
    const sheet = await store.newBudgetSheet("proj-1");
    await store.saveBudgetSheet(sheet, header, [line("175", 100_000_000)]);
    await store.submitBudgetSheet(sheet);
    for (const step of await store.listSteps("budget", sheet)) if (step.result === "pending") await store.sign(step.id, true, "");
    const order = await store.saveDraft({ kind: "project", projectId: "proj-1", budgetCode: "175", advanceRequired: false, advancePct: null, prepayRequired: false, title: "Tủ", department: "", neededBy: null, deliveryAddress: "", supplier: "", supplierContact: "", note: "", items: [{ id: "", name: "Tủ", spec: "", unit: "cái", quantity: 1, unitPrice: 10_000_000 }] });
    await store.submit(order.id);
    for (const step of (await store.listSteps("purchase", order.id)).filter((item) => item.role !== "admin_office")) await store.sign(step.id, true, "");
    await store.issuePo(order.id, "Công ty ABC", "");
    await store.supplierAccept(order.id, "");
    await store.markOrdered(order.id, "Công ty ABC", "", null, "");
    const item = (await store.getOrder(order.id))!.items[0]!;
    const lines = [{ id: item.id, receivedQty: 1, acceptedQty: 1, note: "" }];
    await expect(store.receive(order.id, lines, "")).rejects.toThrow("PO_RECEIPT_RECORD_REQUIRED");
    await expect(store.receive(order.id, lines, "", { recordNo: "BBGN-7", signedByBoth: false })).rejects.toThrow("PO_RECEIPT_RECORD_REQUIRED");
    await store.receive(order.id, lines, "", { recordNo: "BBGN-7", signedByBoth: true });
    expect(await store.getOrder(order.id)).toMatchObject({ status: "received", receiptRecordNo: "BBGN-7" });
  });
});
