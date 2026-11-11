import { systemClock, todayVN, type Clock } from "../../lib/clock";
import type { ProjectStore } from "../../modules/projects/store";
import { actualTotal, estimateTotal } from "../../modules/purchases/flow";
import type { PurchaseStore } from "../../modules/purchases/store";
import type { PurchaseApprover, PurchaseEvent, PurchaseOrder, PurchasePayment, PurchaseStatus } from "../../modules/purchases/types";
import { buildSteps, currentStep, DEPARTMENTS, type ApprovalStep, type DepartmentMembers } from "../../modules/purchases/approval";
import { activeSheet, budgetNumber, categoryAmounts, DEFAULT_COST_CODES, sheetIssue, type BudgetSheet } from "../../modules/purchases/budget";
import { BUDGET_CATEGORIES } from "../../modules/projects/types";

type Data = {
  orders: PurchaseOrder[]; payments: PurchasePayment[]; events: PurchaseEvent[]; approvers: PurchaseApprover[]; seq: number;
  sheets: BudgetSheet[]; steps: ApprovalStep[]; departments: DepartmentMembers; names: Record<string, string>;
};
/** Demo: mỗi bộ phận có một người mẫu để thấy đủ chuỗi ký; người dùng demo là Admin nên ký thay được mọi bước. */
const empty = (): Data => ({
  orders: [], payments: [], events: [], approvers: [{ employeeId: "demo-boss", name: "Nguyễn Gia Luân", hasAccount: true }], seq: 0, sheets: [], steps: [],
  departments: { leader: ["demo-boss"], technical: ["demo-kt"], material: ["demo-vt"], accounting: ["demo-ke"], admin_office: ["demo-hc"] },
  names: { "demo-boss": "Nguyễn Gia Luân", "demo-kt": "Trưởng P. Kỹ thuật (mẫu)", "demo-vt": "Trưởng P. Vật tư (mẫu)", "demo-ke": "Kế toán (mẫu)", "demo-hc": "Hành chánh (mẫu)" },
});
const fail = (code: string): never => { throw new Error(code); };
const clone = <T>(value: T): T => structuredClone(value);

/**
 * Store đặt hàng chế độ demo (localStorage). Người dùng demo vừa là người lập, người duyệt, vừa là người chi để thử trọn quy trình.
 * Hoàn tất đơn dự án ghi phiếu chi vật tư qua store dự án (giống hàm purchase_complete).
 */
export function createMemoryPurchaseStore(options: { persistKey?: string; clock?: Clock; newId?: () => string; userId?: string; projects?: ProjectStore; initial?: Data } = {}): PurchaseStore {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const me = options.userId ?? "demo-admin";
  let data: Data = options.initial ? clone(options.initial) : empty();
  if (options.persistKey && !options.initial) {
    try { const raw = window.localStorage.getItem(options.persistKey); if (raw) data = { ...empty(), ...JSON.parse(raw) as Partial<Data> }; } catch { /* dùng dữ liệu rỗng */ }
  }
  const persist = () => { if (options.persistKey) try { window.localStorage.setItem(options.persistKey, JSON.stringify(data)); } catch { /* trình duyệt chặn lưu */ } };
  const now = () => clock.now();
  const orderOf = (id: string) => data.orders.find((order) => order.id === id) ?? fail("PO_NOT_FOUND");
  const log = (orderId: string, action: string, note = "") => data.events.push({ id: newId(), orderId, at: now(), actorName: "Admin demo", action, note });
  const expect = (order: PurchaseOrder, ...statuses: PurchaseStatus[]) => { if (!statuses.includes(order.status)) fail("PO_BAD_STATUS"); };
  const reason = (note: string) => { if (note.trim().length < 3) fail("PO_REASON_REQUIRED"); };
  const done = () => { persist(); return Promise.resolve(); };
  // Đơn cũ trong localStorage chưa có các trường của quy trình mới
  data.orders = data.orders.map((order) => ({ ...order, budgetCode: order.budgetCode ?? null, budgetA: order.budgetA ?? null, budgetB: order.budgetB ?? null, usesChain: order.usesChain ?? false }));
  const sheetOf = (id: string) => data.sheets.find((sheet) => sheet.id === id) ?? fail("BUDGET_NOT_FOUND");
  const projectSheets = (projectId: string) => data.sheets.filter((sheet) => sheet.projectId === projectId);
  const ordered = (projectId: string, code: string, exclude: string | null) => data.orders
    .filter((order) => order.projectId === projectId && order.budgetCode === code && order.id !== exclude && ["approved", "ordered", "received", "completed"].includes(order.status))
    .reduce((sum, order) => sum + order.totalEstimate, 0);
  const check = (projectId: string, code: string, exclude: string | null) => {
    const sheet = activeSheet(projectSheets(projectId));
    return sheet ? { sheet, a: sheet.lines.find((line) => line.code === code)?.budget ?? 0, b: ordered(projectId, code, exclude) } : null;
  };
  const docSteps = (docType: ApprovalStep["docType"], docId: string) => data.steps.filter((step) => step.docType === docType && step.docId === docId).sort((a, b) => a.seq - b.seq);
  const startChain = (docType: ApprovalStep["docType"], docId: string) => {
    data.steps = data.steps.filter((step) => !(step.docType === docType && step.docId === docId));
    data.steps.push(...buildSteps(docType, docId, todayVN(clock), data.departments, newId));
  };
  const approveSheet = async (sheet: BudgetSheet) => {
    for (const other of projectSheets(sheet.projectId)) if (other.status === "approved") other.status = "superseded";
    Object.assign(sheet, { status: "approved", approvedAt: now() });
    if (options.projects) {
      const amounts = categoryAmounts(sheet.lines);
      const current = await options.projects.getBudgets(sheet.projectId).catch(() => null) ?? [];
      await options.projects.saveBudgets(sheet.projectId, BUDGET_CATEGORIES.map((category) => ({ ...(current.find((item) => item.category === category) ?? { warnPct: 80, plannedHours: null }), category, amount: amounts[category] })), `Duyệt ngân sách theo mã ${sheet.number}`);
    }
  };

  return {
    mode: "demo",
    async myUserId() { return me; },
    async myRoles() { return { isApprover: true, isPayer: true, seesAll: true }; },
    async approvers() { return clone(data.approvers); },
    async setApprovers(employeeIds) { data.approvers = employeeIds.map((employeeId) => data.approvers.find((item) => item.employeeId === employeeId) ?? { employeeId, name: employeeId, hasAccount: false }); return done(); },

    async listOrders() { return clone(data.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async getOrder(id) { return clone(data.orders.find((order) => order.id === id) ?? null); },
    async saveDraft(draft) {
      const existing = draft.id ? orderOf(draft.id) : null;
      if (existing && (existing.status !== "draft" && existing.status !== "rejected")) fail("PO_BAD_STATUS");
      const items = draft.items.map((item) => ({ ...item, id: item.id || newId(), receivedQty: 0, acceptedQty: 0, inspectionNote: "" }));
      const month = todayVN(clock).slice(2, 7).replace("-", "");
      const saved: PurchaseOrder = existing
        ? { ...existing, ...draft, id: existing.id, items, totalEstimate: estimateTotal(items) }
        : {
          budgetA: null, budgetB: null, usesChain: false,
          ...draft, id: newId(), code: `DH-${month}-${String(++data.seq).padStart(4, "0")}`, requesterId: me, requesterName: "Admin demo", expectedDelivery: null, status: "draft",
          totalEstimate: estimateTotal(items), totalActual: null, decisionNote: "", submittedAt: null, approvedAt: null, orderedAt: null, receivedAt: null, completedAt: null, createdAt: now(), items,
        };
      data.orders = [...data.orders.filter((order) => order.id !== saved.id), saved];
      persist();
      return clone(saved);
    },
    async deleteDraft(id) { expect(orderOf(id), "draft"); data.orders = data.orders.filter((order) => order.id !== id); return done(); },
    async listPayments(orderId) { return clone(data.payments.filter((payment) => payment.orderId === orderId)); },
    async listPendingPayments() { return clone(data.payments.filter((payment) => payment.status === "requested" || payment.status === "approved")); },
    async listEvents(orderId) { return clone(data.events.filter((event) => event.orderId === orderId)); },

    async submit(id) {
      const order = orderOf(id); expect(order, "draft", "rejected");
      if (!order.items.length) fail("PO_NO_ITEMS");
      const total = estimateTotal(order.items);
      if (order.kind === "project" && order.projectId) {
        // PRC-01..03: bắt buộc mã ngân sách, ngân sách đã duyệt, không vượt
        if (!order.budgetCode) fail("PO_BUDGET_CODE_REQUIRED");
        const found = check(order.projectId, order.budgetCode!, id) ?? fail("PO_NO_BUDGET");
        if (found.a - (found.b + total) < 0) fail("PO_OVER_BUDGET");
        Object.assign(order, { budgetA: found.a, budgetB: found.b, usesChain: true });
        startChain("purchase", id);
      } else order.usesChain = false;
      Object.assign(order, { status: "submitted", submittedAt: now(), decisionNote: "", totalEstimate: total }); log(id, "submit"); return done();
    },
    async decide(id, approve, note) {
      const order = orderOf(id); if (order.usesChain) fail("PO_USE_CHAIN"); expect(order, "submitted"); if (!approve) reason(note);
      Object.assign(order, { status: approve ? "approved" : "rejected", approvedAt: approve ? now() : null, decisionNote: note.trim() }); log(id, approve ? "approve" : "reject", note); return done();
    },
    async markOrdered(id, supplier, contact, expected, note) {
      const order = orderOf(id); expect(order, "approved"); if (supplier.trim().length < 2) fail("PO_SUPPLIER_REQUIRED");
      Object.assign(order, { status: "ordered", orderedAt: now(), supplier: supplier.trim(), supplierContact: contact.trim(), expectedDelivery: expected });
      log(id, "order", [supplier.trim(), expected ? `giao dự kiến ${expected.split("-").reverse().join("/")}` : "", note.trim()].filter(Boolean).join(" · ")); return done();
    },
    async track(id, note, expected) {
      const order = orderOf(id); expect(order, "approved", "ordered", "received"); if (note.trim().length < 2) fail("PO_NOTE_REQUIRED");
      if (expected) order.expectedDelivery = expected; log(id, "track", note); return done();
    },
    async requestPayment(id, kind, amount, payee, note) {
      const order = orderOf(id); expect(order, "approved", "ordered", "received"); if (kind === "final" && order.status === "approved") fail("PO_BAD_STATUS");
      if (!(amount > 0)) fail("PO_BAD_AMOUNT");
      data.payments.push({ id: newId(), orderId: id, kind, amount, payee: payee.trim(), note: note.trim(), status: "requested", requestedAt: now(), approvedAt: null, paidAt: null, paidMethod: "", decisionNote: "" });
      log(id, `payment_request:${kind}`, `${amount} đ${note.trim() ? ` · ${note.trim()}` : ""}`); return done();
    },
    async decidePayment(paymentId, approve, note) {
      const payment = data.payments.find((item) => item.id === paymentId) ?? fail("PO_NOT_FOUND");
      if (payment.status !== "requested") fail("PO_BAD_STATUS"); if (!approve) reason(note);
      Object.assign(payment, { status: approve ? "approved" : "rejected", approvedAt: now(), decisionNote: note.trim() });
      log(payment.orderId, `${approve ? "payment_approve" : "payment_reject"}:${payment.kind}`, `${payment.amount} đ`); return done();
    },
    async pay(paymentId, method, note) {
      const payment = data.payments.find((item) => item.id === paymentId) ?? fail("PO_NOT_FOUND");
      if (payment.status !== "approved") fail("PO_PAYMENT_NOT_APPROVED");
      Object.assign(payment, { status: "paid", paidAt: now(), paidMethod: method.trim() });
      log(payment.orderId, `paid:${payment.kind}`, [`${payment.amount} đ`, method.trim(), note.trim()].filter(Boolean).join(" · ")); return done();
    },
    async receive(id, lines, note) {
      const order = orderOf(id); expect(order, "ordered", "received");
      order.items = order.items.map((item) => {
        const line = lines.find((entry) => entry.id === item.id);
        if (!line) return item;
        const receivedQty = Math.max(0, line.receivedQty);
        return { ...item, receivedQty, acceptedQty: Math.min(Math.max(0, line.acceptedQty), receivedQty), inspectionNote: line.note.trim() };
      });
      Object.assign(order, { status: "received", receivedAt: order.receivedAt ?? now(), totalActual: actualTotal(order.items) }); log(id, "receive", note); return done();
    },
    async complete(id, note) {
      const order = orderOf(id); expect(order, "received");
      if (data.payments.some((payment) => payment.orderId === id && (payment.status === "requested" || payment.status === "approved"))) fail("PO_PAYMENTS_PENDING");
      if (order.kind === "project" && order.projectId && (order.totalActual ?? 0) > 0 && options.projects) {
        await options.projects.saveExpense({ projectId: order.projectId, spentOn: todayVN(clock), category: "material", description: `Đơn hàng ${order.code}: ${order.title}`.slice(0, 500), supplier: order.supplier, amount: order.totalActual!, status: "approved" });
      }
      Object.assign(order, { status: "completed", completedAt: now() }); log(id, "complete", note); return done();
    },
    async costCodes() { return [...DEFAULT_COST_CODES]; },
    async listBudgetSheets(projectId) { return clone(projectSheets(projectId)).sort((a, b) => b.revision - a.revision); },
    async newBudgetSheet(projectId) {
      const sheets = projectSheets(projectId);
      if (sheets.some((sheet) => ["draft", "submitted", "rejected"].includes(sheet.status))) fail("BUDGET_OPEN_EXISTS");
      const prev = [...sheets].sort((a, b) => b.revision - a.revision)[0];
      const revision = (prev?.revision ?? 0) + 1;
      const code = (await options.projects?.listProjects().catch(() => []))?.find((project) => project.id === projectId)?.code ?? "DA";
      const sheet: BudgetSheet = {
        id: newId(), projectId, revision, number: budgetNumber(code, revision), status: "draft",
        confirmation: prev?.confirmation ?? "tentative", exchangeRate: prev?.exchangeRate ?? 25000, quoteNo: prev?.quoteNo ?? "", offerPrice: prev?.offerPrice ?? 0, contractValue: prev?.contractValue ?? 0,
        note: "", createdAt: now(), submittedAt: null, approvedAt: null, lines: clone(prev?.lines ?? []),
      };
      data.sheets.push(sheet);
      persist();
      return sheet.id;
    },
    async saveBudgetSheet(id, header, lines) {
      const sheet = sheetOf(id);
      if (sheet.status !== "draft" && sheet.status !== "rejected") fail("BUDGET_BAD_STATUS");
      const issue = sheetIssue({ ...header, lines: [...lines] }, false);
      if (issue) fail(issue);
      Object.assign(sheet, header, { lines: clone([...lines]) });
      return done();
    },
    async submitBudgetSheet(id) {
      const sheet = sheetOf(id);
      if (sheet.status !== "draft" && sheet.status !== "rejected") fail("BUDGET_BAD_STATUS");
      const issue = sheetIssue(sheet, true);
      if (issue) fail(issue);
      Object.assign(sheet, { status: "submitted", submittedAt: now() });
      startChain("budget", id);
      return done();
    },
    async deleteBudgetSheet(id) {
      const sheet = sheetOf(id);
      if (sheet.status !== "draft" && sheet.status !== "rejected") fail("BUDGET_BAD_STATUS");
      data.sheets = data.sheets.filter((item) => item.id !== id);
      data.steps = data.steps.filter((step) => !(step.docType === "budget" && step.docId === id));
      return done();
    },
    async checkBudget(projectId, code, orderId) {
      const found = check(projectId, code, orderId);
      return found ? { sheetNumber: found.sheet.number, a: found.a, b: found.b } : null;
    },
    async listSteps(docType, docId) {
      const steps = docSteps(docType, docId);
      const current = currentStep(steps);
      return clone(steps).map((step) => ({ ...step, canSign: step.id === current?.id }));
    },
    async sign(stepId, approve, note) {
      const step = data.steps.find((item) => item.id === stepId) ?? fail("STEP_NOT_FOUND");
      if (currentStep(docSteps(step.docType, step.docId))?.id !== stepId) fail("STEP_NOT_CURRENT");
      if (!approve) reason(note);
      if (step.docType === "purchase") {
        const order = orderOf(step.docId); expect(order, "submitted");
        if (approve && step.role === "leader") {
          const found = check(order.projectId!, order.budgetCode!, order.id) ?? fail("PO_NO_BUDGET");
          if (found.a - (found.b + order.totalEstimate) < 0) fail("PO_OVER_BUDGET");
          Object.assign(order, { status: "approved", approvedAt: now(), budgetA: found.a, budgetB: found.b, decisionNote: note.trim() });
          log(order.id, "approve", note);
        } else if (approve) log(order.id, `sign:${step.role}`, note);
        else { Object.assign(order, { status: "rejected", decisionNote: note.trim() }); log(order.id, "reject", note); }
      } else {
        const sheet = sheetOf(step.docId);
        if (sheet.status !== "submitted") fail("BUDGET_BAD_STATUS");
        if (!approve) sheet.status = "rejected";
        else if (step.role === "leader") await approveSheet(sheet);
      }
      Object.assign(step, { result: approve ? "signed" : "returned", signerName: "Admin demo", note: note.trim(), actedAt: now() });
      return done();
    },
    async myApprovals() {
      const docs = new Map<string, ApprovalStep[]>();
      for (const step of data.steps) docs.set(`${step.docType}:${step.docId}`, [...(docs.get(`${step.docType}:${step.docId}`) ?? []), step]);
      const projects = await options.projects?.listProjects().catch(() => []) ?? [];
      const out = [];
      for (const steps of docs.values()) {
        const step = currentStep(steps);
        if (!step) continue;
        const order = step.docType === "purchase" ? data.orders.find((item) => item.id === step.docId) : undefined;
        const sheet = step.docType === "budget" ? data.sheets.find((item) => item.id === step.docId) : undefined;
        const projectId = order?.projectId ?? sheet?.projectId ?? null;
        out.push({
          stepId: step.id, docType: step.docType, docId: step.docId, projectId, projectCode: projects.find((project) => project.id === projectId)?.code ?? "",
          title: order ? `${order.code} · ${order.title}` : `Ngân sách ${sheet?.number ?? ""}`,
          amount: order?.totalEstimate ?? sheet?.lines.reduce((sum, line) => sum + line.budget, 0) ?? 0, role: step.role, targetDate: step.targetDate,
        });
      }
      return out.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    },
    async departments() { return DEPARTMENTS.flatMap((department) => data.departments[department].map((employeeId) => ({ department, employeeId, name: data.names[employeeId] ?? employeeId }))); },
    async setDepartments(members) { data.departments = clone(members); return done(); },
    async cancel(id, note) {
      const order = orderOf(id); reason(note); if (order.status === "completed" || order.status === "cancelled") fail("PO_BAD_STATUS");
      for (const payment of data.payments) if (payment.orderId === id && (payment.status === "requested" || payment.status === "approved")) Object.assign(payment, { status: "rejected", decisionNote: "Đơn bị hủy" });
      Object.assign(order, { status: "cancelled", decisionNote: note.trim() }); log(id, "cancel", note); return done();
    },
  };
}
