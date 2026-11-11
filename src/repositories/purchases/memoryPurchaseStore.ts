import { systemClock, todayVN, type Clock } from "../../lib/clock";
import type { ProjectStore } from "../../modules/projects/store";
import { actualTotal, estimateTotal, orderBlock, paymentIssue, poBlock } from "../../modules/purchases/flow";
import type { PurchaseStore } from "../../modules/purchases/store";
import type { PurchaseApprover, PurchaseEvent, PurchaseOrder, PurchasePayment, PurchaseStatus } from "../../modules/purchases/types";
import { buildSteps, currentStep, DEPARTMENTS, type ApprovalStep, type DepartmentMembers } from "../../modules/purchases/approval";
import { activeSheet, budgetNumber, categoryAmounts, DEFAULT_COST_CODES, sheetIssue, type BudgetSheet } from "../../modules/purchases/budget";
import { BUDGET_CATEGORIES } from "../../modules/projects/types";
import { budgetIncrements, explanatoryIssue, explanatoryNumber, type ExplanatoryReport } from "../../modules/purchases/explanatory";
import { materialIssue, materialNumber, ordersFromQuote, type MaterialQuote, type MaterialRequest } from "../../modules/purchases/materials";
import { contractIssue, noContractAttachments, type ProjectContract } from "../../modules/purchases/contract";

type Data = {
  orders: PurchaseOrder[]; payments: PurchasePayment[]; events: PurchaseEvent[]; approvers: PurchaseApprover[]; seq: number;
  sheets: BudgetSheet[]; steps: ApprovalStep[]; departments: DepartmentMembers; names: Record<string, string>;
  explanatory: ExplanatoryReport[]; materials: MaterialRequest[]; quotes: MaterialQuote[]; contracts: ProjectContract[];
};
/** Demo: mỗi bộ phận có một người mẫu để thấy đủ chuỗi ký; người dùng demo là Admin nên ký thay được mọi bước. */
const empty = (): Data => ({
  orders: [], payments: [], events: [], approvers: [{ employeeId: "demo-boss", name: "Nguyễn Gia Luân", hasAccount: true }], seq: 0, sheets: [], steps: [],
  explanatory: [], materials: [], quotes: [], contracts: [],
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
  data.orders = data.orders.map((order) => ({ ...order, budgetCode: order.budgetCode ?? null, budgetA: order.budgetA ?? null, budgetB: order.budgetB ?? null, usesChain: order.usesChain ?? false,
    advanceRequired: order.advanceRequired ?? false, advancePct: order.advancePct ?? null, prepayRequired: order.prepayRequired ?? false,
    poNo: order.poNo ?? "", poIssuedAt: order.poIssuedAt ?? null, supplierAcceptedAt: order.supplierAcceptedAt ?? null, supplierAcceptNote: order.supplierAcceptNote ?? "", receiptRecordNo: order.receiptRecordNo ?? "" }));
  data.payments = data.payments.map((payment) => ({ ...payment, rfpNo: payment.rfpNo ?? "", invoiceNo: payment.invoiceNo ?? "", invoiceDate: payment.invoiceDate ?? null, vatAmount: payment.vatAmount ?? 0, usesChain: payment.usesChain ?? false }));
  let rfpSeq = data.payments.filter((payment) => payment.rfpNo).length;
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

  const projectCode = async (projectId: string) => (await options.projects?.listProjects().catch(() => []))?.find((project) => project.id === projectId)?.code ?? "DA";
  const reportOf = (id: string) => data.explanatory.find((item) => item.id === id) ?? fail("EXP_NOT_FOUND");
  const requestOf = (id: string) => data.materials.find((item) => item.id === id) ?? fail("MR_NOT_FOUND");
  const contractOf = (id: string) => data.contracts.find((item) => item.id === id) ?? fail("CONTRACT_NOT_FOUND");
  const editableStatus = (status: string) => status === "draft" || status === "rejected";
  /** PRC-41: Lãnh đạo duyệt P-COST-05 → cộng E vào mã của ngân sách đang dùng, tính lại 4 khoản. */
  const applyExplanatory = async (report: ExplanatoryReport) => {
    const sheet = activeSheet(projectSheets(report.projectId)) ?? fail("PO_NO_BUDGET");
    for (const { code, amount } of budgetIncrements(report.lines)) {
      const line = sheet.lines.find((item) => item.code === code);
      if (line) line.budget += amount;
      else sheet.lines.push({ code, nett: 0, budget: amount, supplier: "", contingency: 0, remark: `Tăng theo ${report.number}` });
    }
    sheet.lines.sort((a, b) => a.code.localeCompare(b.code));
    if (options.projects) {
      const amounts = categoryAmounts(sheet.lines);
      const current = await options.projects.getBudgets(sheet.projectId).catch(() => null) ?? [];
      await options.projects.saveBudgets(sheet.projectId, BUDGET_CATEGORIES.map((category) => ({ ...(current.find((item) => item.category === category) ?? { warnPct: 80, plannedHours: null }), category, amount: amounts[category] })), `Duyệt báo cáo giải thích ${report.number}`);
    }
  };

  return {
    mode: "demo",
    async myUserId() { return me; },
    async myRoles() { return { isApprover: true, isPayer: true, seesAll: true, isAdminOffice: true }; },
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
          budgetA: null, budgetB: null, usesChain: false, poNo: "", poIssuedAt: null, supplierAcceptedAt: null, supplierAcceptNote: "", receiptRecordNo: "",
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
      const blocked = orderBlock(order, data.payments.filter((payment) => payment.orderId === id)); if (blocked) fail(blocked);
      Object.assign(order, { status: "ordered", orderedAt: now(), supplier: supplier.trim(), supplierContact: contact.trim(), expectedDelivery: expected });
      log(id, "order", [supplier.trim(), expected ? `giao dự kiến ${expected.split("-").reverse().join("/")}` : "", note.trim()].filter(Boolean).join(" · ")); return done();
    },
    async track(id, note, expected) {
      const order = orderOf(id); expect(order, "approved", "ordered", "received"); if (note.trim().length < 2) fail("PO_NOTE_REQUIRED");
      if (expected) order.expectedDelivery = expected; log(id, "track", note); return done();
    },
    async requestPayment(id, input) {
      const order = orderOf(id); expect(order, "approved", "ordered", "received"); if (input.kind === "final" && order.status === "approved") fail("PO_BAD_STATUS");
      // PRC-30: đơn quy trình mới chỉ cho loại khoản NCC cần
      if (order.usesChain && ((input.kind === "advance" && !order.advanceRequired) || (input.kind === "prepayment" && !order.prepayRequired))) fail("PO_PAYMENT_NOT_NEEDED");
      if (input.kind === "advance") { const blocked = poBlock(order); if (blocked) fail(blocked); }
      const issue = paymentIssue(order, data.payments.filter((payment) => payment.orderId === id), input); if (issue) fail(issue);
      const month = todayVN(clock).slice(2, 7).replace("-", "");
      const payment: PurchasePayment = {
        id: newId(), orderId: id, kind: input.kind, amount: input.amount, payee: input.payee.trim(), note: input.note.trim(), status: "requested", requestedAt: now(), approvedAt: null, paidAt: null, paidMethod: "", decisionNote: "",
        rfpNo: `RFP-${month}-${String(++rfpSeq).padStart(4, "0")}`, invoiceNo: input.kind === "advance" ? "tạm ứng" : input.invoiceNo.trim(), invoiceDate: input.invoiceDate, vatAmount: input.vatAmount, usesChain: order.usesChain,
      };
      data.payments.push(payment);
      if (payment.usesChain) startChain("payment", payment.id);
      log(id, `payment_request:${input.kind}`, `${payment.rfpNo} · ${input.amount} đ${input.note.trim() ? ` · ${input.note.trim()}` : ""}`); return done();
    },
    async decidePayment(paymentId, approve, note) {
      const payment = data.payments.find((item) => item.id === paymentId) ?? fail("PO_NOT_FOUND");
      if (payment.usesChain) fail("PO_USE_CHAIN");
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
    async issuePo(id, supplier, contact) {
      const order = orderOf(id); expect(order, "approved");
      if (!order.usesChain || order.poIssuedAt) fail("PO_BAD_STATUS");
      if (supplier.trim().length < 2) fail("PO_SUPPLIER_REQUIRED");
      const projects = await options.projects?.listProjects().catch(() => []) ?? [];
      const code = projects.find((project) => project.id === order.projectId)?.code ?? "DA";
      const issued = data.orders.filter((item) => item.projectId === order.projectId && item.poNo).length;
      Object.assign(order, { poNo: `PO-${code}-${String(issued + 1).padStart(3, "0")}`, poIssuedAt: now(), supplier: supplier.trim(), supplierContact: contact.trim() });
      // Phát hành PO = Hành chánh ký nhận đơn nháp
      const office = docSteps("purchase", id).find((step) => step.role === "admin_office" && step.result === "pending");
      if (office) Object.assign(office, { result: "signed", signerName: "Admin demo", note: `Phát hành ${order.poNo}`, actedAt: now() });
      log(id, "issue_po", `${order.poNo} · ${supplier.trim()}`); return done();
    },
    async supplierAccept(id, note) {
      const order = orderOf(id); expect(order, "approved");
      if (!order.poIssuedAt || order.supplierAcceptedAt) fail("PO_BAD_STATUS");
      Object.assign(order, { supplierAcceptedAt: now(), supplierAcceptNote: note.trim() });
      log(id, "supplier_accept", note); return done();
    },
    async receive(id, lines, note, record) {
      const order = orderOf(id); expect(order, "ordered", "received");
      // PRC-35: đơn dự án cần biên bản giao nhận có chữ ký hai bên
      if (order.usesChain && (!record || !record.recordNo.trim() || !record.signedByBoth)) fail("PO_RECEIPT_RECORD_REQUIRED");
      if (record?.recordNo.trim()) order.receiptRecordNo = record.recordNo.trim();
      order.items = order.items.map((item) => {
        const line = lines.find((entry) => entry.id === item.id);
        if (!line) return item;
        const receivedQty = Math.max(0, line.receivedQty);
        return { ...item, receivedQty, acceptedQty: Math.min(Math.max(0, line.acceptedQty), receivedQty), inspectionNote: line.note.trim() };
      });
      Object.assign(order, { status: "received", receivedAt: order.receivedAt ?? now(), totalActual: actualTotal(order.items) });
      log(id, "receive", [record?.recordNo.trim() ? `Biên bản giao nhận ${record.recordNo.trim()} (hai bên đã ký)` : "", note.trim()].filter(Boolean).join(" · ")); return done();
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
      if (step.docType === "payment") {
        const payment = data.payments.find((item) => item.id === step.docId) ?? fail("PO_NOT_FOUND");
        if (payment.status !== "requested") fail("PO_BAD_STATUS");
        if (!approve) { Object.assign(payment, { status: "rejected", decisionNote: note.trim() }); log(payment.orderId, `payment_reject:${payment.kind}`, `${payment.rfpNo} · ${note.trim()}`); }
        else if (step.role === "leader") { Object.assign(payment, { status: "approved", approvedAt: now(), decisionNote: note.trim() }); log(payment.orderId, `payment_approve:${payment.kind}`, `${payment.rfpNo} · ${payment.amount} đ`); }
        else log(payment.orderId, `payment_sign:${step.role}`, payment.rfpNo);
      } else if (step.docType === "purchase") {
        const order = orderOf(step.docId); expect(order, "submitted");
        if (approve && step.role === "leader") {
          const found = check(order.projectId!, order.budgetCode!, order.id) ?? fail("PO_NO_BUDGET");
          if (found.a - (found.b + order.totalEstimate) < 0) fail("PO_OVER_BUDGET");
          Object.assign(order, { status: "approved", approvedAt: now(), budgetA: found.a, budgetB: found.b, decisionNote: note.trim() });
          log(order.id, "approve", note);
        } else if (approve) log(order.id, `sign:${step.role}`, note);
        else { Object.assign(order, { status: "rejected", decisionNote: note.trim() }); log(order.id, "reject", note); }
      } else if (step.docType === "explanatory") {
        const report = reportOf(step.docId);
        if (report.status !== "submitted") fail("EXP_BAD_STATUS");
        if (!approve) report.status = "rejected";
        else if (step.role === "leader") { await applyExplanatory(report); Object.assign(report, { status: "approved", approvedAt: now() }); }
      } else if (step.docType === "material") {
        const request = requestOf(step.docId);
        if (request.status !== "submitted") fail("MR_BAD_STATUS");
        if (!approve) request.status = "rejected";
        else if (step.role === "leader") Object.assign(request, { status: "approved", approvedAt: now() });
      } else if (step.docType === "contract") {
        // Kế toán, Hành chánh ký sau Lãnh đạo (lên số dự án, lưu hồ sơ) khi xác nhận đã được duyệt
        const contract = contractOf(step.docId);
        if (contract.status !== "submitted" && contract.status !== "approved") fail("CONTRACT_BAD_STATUS");
        if (!approve) contract.status = "rejected";
        else if (step.role === "leader") {
          for (const other of data.contracts) if (other.projectId === contract.projectId && other.status === "approved") other.status = "superseded";
          Object.assign(contract, { status: "approved", approvedAt: now() });
        }
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
        const payment = step.docType === "payment" ? data.payments.find((item) => item.id === step.docId) : undefined;
        const order = step.docType === "purchase" ? data.orders.find((item) => item.id === step.docId) : payment ? data.orders.find((item) => item.id === payment.orderId) : undefined;
        const sheet = step.docType === "budget" ? data.sheets.find((item) => item.id === step.docId) : undefined;
        const report = step.docType === "explanatory" ? data.explanatory.find((item) => item.id === step.docId) : undefined;
        const request = step.docType === "material" ? data.materials.find((item) => item.id === step.docId) : undefined;
        const contract = step.docType === "contract" ? data.contracts.find((item) => item.id === step.docId) : undefined;
        const projectId = order?.projectId ?? sheet?.projectId ?? report?.projectId ?? request?.projectId ?? contract?.projectId ?? null;
        if (report || request || contract) {
          out.push({
            stepId: step.id, docType: step.docType, docId: step.docId, projectId, projectCode: projects.find((project) => project.id === projectId)?.code ?? "",
            title: report ? `${report.number} · ${report.explanation.slice(0, 60)}` : request ? `${request.number} · ${request.items.length} dòng vật tư` : `Xác nhận dự án lần ${contract!.revision}`,
            amount: report ? Math.max(0, report.lines.reduce((sum, line) => sum + line.orderedB + line.neededC - line.budgetA, 0)) : contract ? contract.confirmedValue : 0,
            role: step.role, targetDate: step.targetDate,
          });
          continue;
        }
        out.push({
          stepId: step.id, docType: step.docType, docId: step.docId, projectId, projectCode: projects.find((project) => project.id === projectId)?.code ?? "",
          title: payment && order ? `${payment.rfpNo} · ${order.code} · ${order.title}` : order ? `${order.code} · ${order.title}` : `Ngân sách ${sheet?.number ?? ""}`,
          amount: payment ? payment.amount + payment.vatAmount : order?.totalEstimate ?? sheet?.lines.reduce((sum, line) => sum + line.budget, 0) ?? 0, role: step.role, targetDate: step.targetDate,
          ...(payment ? { orderId: payment.orderId } : {}),
        });
      }
      return out.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    },
    async departments() { return DEPARTMENTS.flatMap((department) => data.departments[department].map((employeeId) => ({ department, employeeId, name: data.names[employeeId] ?? employeeId }))); },
    async setDepartments(members) { data.departments = clone(members); return done(); },
    async listExplanatory(projectId) { return clone(data.explanatory.filter((item) => item.projectId === projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async saveExplanatory(draft) {
      const issue = explanatoryIssue(draft, false); if (issue) fail(issue);
      if (draft.id) {
        const report = reportOf(draft.id); if (!editableStatus(report.status)) fail("EXP_BAD_STATUS");
        Object.assign(report, { kind: draft.kind, warrantyDoneOn: draft.warrantyDoneOn, explanation: draft.explanation.trim(), attachments: clone(draft.attachments), orderId: draft.orderId, lines: clone(draft.lines) });
        persist(); return report.id;
      }
      const seq = data.explanatory.filter((item) => item.projectId === draft.projectId).length + 1;
      const report: ExplanatoryReport = {
        id: newId(), projectId: draft.projectId, number: explanatoryNumber(await projectCode(draft.projectId), seq), kind: draft.kind, warrantyDoneOn: draft.warrantyDoneOn,
        explanation: draft.explanation.trim(), attachments: clone(draft.attachments), status: "draft", orderId: draft.orderId, createdByName: "Admin demo", createdAt: now(), submittedAt: null, approvedAt: null, lines: clone(draft.lines),
      };
      data.explanatory.push(report); persist(); return report.id;
    },
    async submitExplanatory(id) {
      const report = reportOf(id); if (!editableStatus(report.status)) fail("EXP_BAD_STATUS");
      const issue = explanatoryIssue(report, true); if (issue) fail(issue);
      if (!activeSheet(projectSheets(report.projectId))) fail("PO_NO_BUDGET");
      Object.assign(report, { status: "submitted", submittedAt: now() }); startChain("explanatory", id); return done();
    },
    async deleteExplanatory(id) {
      const report = reportOf(id); if (!editableStatus(report.status)) fail("EXP_BAD_STATUS");
      data.explanatory = data.explanatory.filter((item) => item.id !== id); data.steps = data.steps.filter((step) => !(step.docType === "explanatory" && step.docId === id)); return done();
    },

    async listMaterialRequests(projectId) { return clone(data.materials.filter((item) => item.projectId === projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async saveMaterialRequest(draft) {
      const issue = materialIssue(draft, false); if (issue) fail(issue);
      const items = draft.items.map((item) => ({ ...item, id: item.id && !item.id.startsWith("tmp-") ? item.id : newId(), name: item.name.trim(), spec: item.spec.trim(), maker: item.maker.trim(), unit: item.unit.trim(), note: item.note.trim() }));
      if (draft.id) {
        const request = requestOf(draft.id); if (!editableStatus(request.status)) fail("MR_BAD_STATUS");
        Object.assign(request, { requestedOn: draft.requestedOn, note: draft.note.trim(), items }); persist(); return request.id;
      }
      const seq = data.materials.filter((item) => item.projectId === draft.projectId).length + 1;
      const request: MaterialRequest = {
        id: newId(), projectId: draft.projectId, number: materialNumber(await projectCode(draft.projectId), seq), requesterName: "Admin demo", requestedOn: draft.requestedOn,
        status: "draft", note: draft.note.trim(), items, createdAt: now(), submittedAt: null, approvedAt: null, orderIds: [],
      };
      data.materials.push(request); persist(); return request.id;
    },
    async submitMaterialRequest(id) {
      const request = requestOf(id); if (!editableStatus(request.status)) fail("MR_BAD_STATUS");
      const issue = materialIssue(request, true); if (issue) fail(issue);
      Object.assign(request, { status: "submitted", submittedAt: now() }); startChain("material", id); return done();
    },
    async deleteMaterialRequest(id) {
      const request = requestOf(id); if (request.status !== "draft") fail("MR_BAD_STATUS");
      data.materials = data.materials.filter((item) => item.id !== id); data.quotes = data.quotes.filter((quote) => quote.requestId !== id); return done();
    },
    async closeMaterialRequest(id, note) {
      const request = requestOf(id); reason(note); if (!["approved", "ordered"].includes(request.status)) fail("MR_BAD_STATUS");
      Object.assign(request, { status: "closed", note: [request.note, `Đóng: ${note.trim()}`].filter(Boolean).join(" · ") }); return done();
    },
    async setMaterialCodes(id, codes) {
      const request = requestOf(id); if (request.status === "closed" || request.status === "submitted") fail("MR_BAD_STATUS");
      const items = request.items.map((item) => item.id in codes ? { ...item, budgetCode: codes[item.id] || null } : item);
      const issue = materialIssue({ items }, false); if (issue) fail(issue);
      request.items = items; return done();
    },
    async listQuotes(requestId) { return clone(data.quotes.filter((quote) => quote.requestId === requestId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async saveQuote(draft) {
      const request = requestOf(draft.requestId); if (!["approved", "ordered"].includes(request.status)) fail("MR_NOT_APPROVED");
      if (draft.supplier.trim().length < 2) fail("PO_SUPPLIER_REQUIRED");
      if (Object.values(draft.prices).some((price) => !Number.isFinite(price) || price < 0)) fail("BUDGET_BAD_AMOUNT");
      const body = { ...clone(draft), supplier: draft.supplier.trim(), supplierContact: draft.supplierContact.trim(), quoteRef: draft.quoteRef.trim(), paymentTerms: draft.paymentTerms.trim(), note: draft.note.trim() };
      if (draft.id) { const quote = data.quotes.find((item) => item.id === draft.id) ?? fail("MR_QUOTE_NOT_FOUND"); if (quote.selected) fail("MR_QUOTE_USED"); Object.assign(quote, body); persist(); return quote.id; }
      const quote: MaterialQuote = { ...body, id: newId(), selected: false, createdAt: now() };
      data.quotes.push(quote); persist(); return quote.id;
    },
    async deleteQuote(id) {
      const quote = data.quotes.find((item) => item.id === id) ?? fail("MR_QUOTE_NOT_FOUND"); if (quote.selected) fail("MR_QUOTE_USED");
      data.quotes = data.quotes.filter((item) => item.id !== id); return done();
    },
    async ordersFromQuote(requestId, quoteId) {
      const request = requestOf(requestId); if (!["approved", "ordered"].includes(request.status)) fail("MR_NOT_APPROVED");
      const quote = data.quotes.find((item) => item.id === quoteId && item.requestId === requestId) ?? fail("MR_QUOTE_NOT_FOUND");
      if (quote.selected) fail("MR_QUOTE_USED");
      const drafts = ordersFromQuote(request, quote);
      if (!Array.isArray(drafts)) return fail(drafts.error);
      const ids: string[] = [];
      for (const draft of drafts) ids.push((await this.saveDraft(draft)).id);
      quote.selected = true;
      Object.assign(request, { status: "ordered", orderIds: [...request.orderIds, ...ids] });
      persist();
      return ids;
    },

    async listContracts(projectId) { return clone(data.contracts.filter((item) => item.projectId === projectId)).sort((a, b) => b.revision - a.revision); },
    async newContract(projectId) {
      const list = data.contracts.filter((item) => item.projectId === projectId);
      if (list.some((item) => ["draft", "submitted", "rejected"].includes(item.status))) fail("CONTRACT_OPEN_EXISTS");
      const prev = [...list].sort((a, b) => b.revision - a.revision)[0];
      const project = (await options.projects?.listProjects().catch(() => []))?.find((item) => item.id === projectId);
      const contract: ProjectContract = prev ? { ...clone(prev), id: newId(), revision: prev.revision + 1, status: "draft", createdAt: now(), submittedAt: null, approvedAt: null, issuedOn: todayVN(clock) } : {
        id: newId(), projectId, revision: 1, status: "draft", confirmation: "tentative", issuedOn: todayVN(clock), description: project?.name ?? "", quoteNo: "", quoteDate: null, quoteValue: 0, confirmedValue: 0,
        customerDocNo: "", customerDocDate: null, paymentTerms: "", customerName: "", ownerName: "", startOn: project?.plannedStart ?? null, endOn: project?.plannedEnd ?? null,
        attachments: noContractAttachments(), note: "", createdAt: now(), submittedAt: null, approvedAt: null,
      };
      data.contracts.push(contract); persist(); return contract.id;
    },
    async saveContract(id, draft) {
      const contract = contractOf(id); if (!editableStatus(contract.status)) fail("CONTRACT_BAD_STATUS");
      const issue = contractIssue(draft, false); if (issue) fail(issue);
      Object.assign(contract, clone(draft)); return done();
    },
    async submitContract(id) {
      const contract = contractOf(id); if (!editableStatus(contract.status)) fail("CONTRACT_BAD_STATUS");
      const issue = contractIssue(contract, true); if (issue) fail(issue);
      Object.assign(contract, { status: "submitted", submittedAt: now() }); startChain("contract", id); return done();
    },
    async deleteContract(id) {
      const contract = contractOf(id); if (!editableStatus(contract.status)) fail("CONTRACT_BAD_STATUS");
      data.contracts = data.contracts.filter((item) => item.id !== id); data.steps = data.steps.filter((step) => !(step.docType === "contract" && step.docId === id)); return done();
    },
    async cancel(id, note) {
      const order = orderOf(id); reason(note); if (order.status === "completed" || order.status === "cancelled") fail("PO_BAD_STATUS");
      for (const payment of data.payments) if (payment.orderId === id && (payment.status === "requested" || payment.status === "approved")) Object.assign(payment, { status: "rejected", decisionNote: "Đơn bị hủy" });
      Object.assign(order, { status: "cancelled", decisionNote: note.trim() }); log(id, "cancel", note); return done();
    },
  };
}
