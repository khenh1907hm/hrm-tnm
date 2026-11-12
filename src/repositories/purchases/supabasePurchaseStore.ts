import { dispatchNotificationEmails } from "../../lib/approvalEmailDispatch";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseStore } from "../../modules/purchases/store";
import type { PurchaseEvent, PurchaseItem, PurchaseOrder, PurchasePayment } from "../../modules/purchases/types";
import { groupOf, type BudgetSheet, type CostCode } from "../../modules/purchases/budget";
import type { ApprovalStep, Department } from "../../modules/purchases/approval";
import type { ExplanatoryReport } from "../../modules/purchases/explanatory";
import type { MaterialQuote, MaterialRequest } from "../../modules/purchases/materials";
import type { ProjectContract } from "../../modules/purchases/contract";

type Row = Record<string, unknown>;
const num = (value: unknown) => value === null || value === undefined ? 0 : Number(value);
const str = (value: unknown) => value === null || value === undefined ? "" : String(value);
const strOrNull = (value: unknown) => value === null || value === undefined ? null : String(value);

function raise(error: PostgrestError): never {
  if (/^[A-Z][A-Z0-9_]{2,}(:.*)?$/.test(error.message)) throw new Error(error.message);
  if (error.code === "42501") throw new Error("FORBIDDEN");
  throw new Error(`PROJECT_SAVE_FAILED:${error.message}`);
}

const itemFromRow = (row: Row): PurchaseItem => ({ id: str(row.id), name: str(row.name), spec: str(row.spec), unit: str(row.unit), quantity: num(row.quantity), unitPrice: num(row.unit_price), receivedQty: num(row.received_qty), acceptedQty: num(row.accepted_qty), inspectionNote: str(row.inspection_note) });
const orderFromRow = (row: Row): PurchaseOrder => ({
  id: str(row.id), code: str(row.code), kind: row.kind as PurchaseOrder["kind"], projectId: strOrNull(row.project_id), title: str(row.title), requesterId: str(row.requester_id), requesterName: str(row.requester_name),
  department: str(row.department), neededBy: strOrNull(row.needed_by), deliveryAddress: str(row.delivery_address), supplier: str(row.supplier), supplierContact: str(row.supplier_contact), expectedDelivery: strOrNull(row.expected_delivery),
  note: str(row.note), status: row.status as PurchaseOrder["status"], totalEstimate: num(row.total_estimate), totalActual: row.total_actual === null ? null : num(row.total_actual), decisionNote: str(row.decision_note),
  submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at), orderedAt: strOrNull(row.ordered_at), receivedAt: strOrNull(row.received_at), completedAt: strOrNull(row.completed_at), createdAt: str(row.created_at),
  items: ((row.purchase_items ?? []) as Row[]).sort((a, b) => num(a.sort) - num(b.sort)).map(itemFromRow),
  budgetCode: strOrNull(row.budget_code), budgetA: row.budget_a === null || row.budget_a === undefined ? null : num(row.budget_a),
  budgetB: row.budget_b === null || row.budget_b === undefined ? null : num(row.budget_b), usesChain: Boolean(row.uses_chain),
  poNo: str(row.po_no), poIssuedAt: strOrNull(row.po_issued_at), supplierAcceptedAt: strOrNull(row.supplier_accepted_at), supplierAcceptNote: str(row.supplier_accept_note), receiptRecordNo: str(row.receipt_record_no),
  advanceRequired: Boolean(row.advance_required), advancePct: row.advance_pct === null || row.advance_pct === undefined ? null : num(row.advance_pct), prepayRequired: Boolean(row.prepay_required),
});
const sheetFromRow = (row: Row): BudgetSheet => ({
  id: str(row.id), projectId: str(row.project_id), revision: num(row.revision), number: str(row.number), status: row.status as BudgetSheet["status"],
  confirmation: row.confirmation as BudgetSheet["confirmation"], exchangeRate: num(row.exchange_rate), quoteNo: str(row.quote_no), offerPrice: num(row.offer_price),
  contractValue: num(row.contract_value), note: str(row.note), createdAt: str(row.created_at), submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at),
  lines: ((row.project_budget_lines ?? []) as Row[]).map((line) => ({ code: str(line.code), nett: num(line.nett), budget: num(line.budget), supplier: str(line.supplier), contingency: num(line.contingency), remark: str(line.remark) }))
    .sort((a, b) => a.code.localeCompare(b.code)),
});
const paymentFromRow = (row: Row): PurchasePayment => ({ id: str(row.id), orderId: str(row.order_id), kind: row.kind as PurchasePayment["kind"], amount: num(row.amount), payee: str(row.payee), note: str(row.note), status: row.status as PurchasePayment["status"], requestedAt: str(row.requested_at), approvedAt: strOrNull(row.approved_at), paidAt: strOrNull(row.paid_at), paidMethod: str(row.paid_method), decisionNote: str(row.decision_note),
  rfpNo: str(row.rfp_no), invoiceNo: str(row.invoice_no), invoiceDate: strOrNull(row.invoice_date), vatAmount: num(row.vat_amount), usesChain: Boolean(row.uses_chain) });
const ORDER_COLUMNS = "*, purchase_items(*)";
const bool = (value: unknown) => value === true || value === "true";
const reportFromRow = (row: Row): ExplanatoryReport => {
  const attachments = (row.attachments ?? {}) as Record<string, unknown>;
  return {
    id: str(row.id), projectId: str(row.project_id), number: str(row.number), kind: row.kind as ExplanatoryReport["kind"], warrantyDoneOn: strOrNull(row.warranty_done_on), explanation: str(row.explanation),
    attachments: { customerRequest: bool(attachments.customerRequest), overQuote: bool(attachments.overQuote), incident: bool(attachments.incident), drawing: bool(attachments.drawing) },
    status: row.status as ExplanatoryReport["status"], orderId: strOrNull(row.order_id), createdByName: str(row.created_by_name), createdAt: str(row.created_at), submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at),
    lines: ((row.explanatory_report_lines ?? []) as Row[]).map((line) => ({ code: str(line.code), budgetA: num(line.budget_a), orderedB: num(line.ordered_b), neededC: num(line.needed_c) })).sort((a, b) => a.code.localeCompare(b.code)),
  };
};
const requestFromRow = (row: Row): MaterialRequest => ({
  id: str(row.id), projectId: str(row.project_id), number: str(row.number), requesterName: str(row.requester_name), requestedOn: str(row.requested_on), status: row.status as MaterialRequest["status"], note: str(row.note),
  createdAt: str(row.created_at), submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at),
  items: ((row.material_request_items ?? []) as Row[]).sort((a, b) => num(a.sort) - num(b.sort)).map((item) => ({
    id: str(item.id), name: str(item.name), spec: str(item.spec), maker: str(item.maker), unit: str(item.unit), quantity: num(item.quantity), neededOn: strOrNull(item.needed_on), note: str(item.note), budgetCode: strOrNull(item.budget_code),
  })),
  orderIds: ((row.purchase_orders ?? []) as Row[]).map((order) => str(order.id)),
});
const contractFromRow = (row: Row): ProjectContract => {
  const attachments = (row.attachments ?? {}) as Record<string, unknown>;
  return {
    id: str(row.id), projectId: str(row.project_id), revision: num(row.revision), status: row.status as ProjectContract["status"], confirmation: row.confirmation as ProjectContract["confirmation"],
    issuedOn: str(row.issued_on), description: str(row.description), quoteNo: str(row.quote_no), quoteDate: strOrNull(row.quote_date), quoteValue: num(row.quote_value), confirmedValue: num(row.confirmed_value),
    customerDocNo: str(row.customer_doc_no), customerDocDate: strOrNull(row.customer_doc_date), paymentTerms: str(row.payment_terms), customerName: str(row.customer_name), ownerName: str(row.owner_name),
    startOn: strOrNull(row.start_on), endOn: strOrNull(row.end_on), note: str(row.note), createdAt: str(row.created_at), submittedAt: strOrNull(row.submitted_at), approvedAt: strOrNull(row.approved_at),
    attachments: { signedQuoteOrPo: bool(attachments.signedQuoteOrPo), stampedQuote: bool(attachments.stampedQuote), customerInstruction: bool(attachments.customerInstruction), masterSchedule: bool(attachments.masterSchedule), drawings: bool(attachments.drawings) },
  };
};

/** Store đặt hàng chế độ thật: đọc qua RLS, mọi bước chuyển trạng thái gọi hàm purchase_* ở máy chủ. */
export function createSupabasePurchaseStore(client: SupabaseClient): PurchaseStore {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(name, args);
    if (error) raise(error);
    // Gửi / ký phiếu tạo thông báo cho người đến lượt: nhờ máy chủ gửi email luôn
    if (/_submit$|^approval_sign$|^purchase_request_rfp$/.test(name)) dispatchNotificationEmails();
    return data as unknown;
  };
  const check = async (request: PromiseLike<{ error: PostgrestError | null }>) => { const { error } = await request; if (error) raise(error); };
  return {
    mode: "live",
    async myUserId() { const { data } = await client.auth.getUser(); return data.user?.id ?? ""; },
    async myRoles() {
      const row = ((await rpc("purchase_my_roles", {})) as Row[] | null)?.[0];
      // Bộ phận Hành chánh (phát hành PO); máy chủ chưa có hàm thì coi như không
      const departments = ((await rpc("procurement_my_departments", {}).catch(() => [])) ?? []) as string[];
      return { isApprover: Boolean(row?.is_approver), isPayer: Boolean(row?.is_payer), seesAll: Boolean(row?.sees_all), isAdminOffice: departments.includes("admin_office") };
    },
    async approvers() { return (((await rpc("purchase_approvers", {})) ?? []) as Row[]).map((row) => ({ employeeId: str(row.employee_id), name: str(row.name), hasAccount: Boolean(row.has_account) })); },
    async setApprovers(employeeIds) { await check(client.from("purchase_settings").update({ approver_employee_ids: employeeIds, updated_at: new Date().toISOString() }).eq("id", 1)); },

    async listOrders() {
      const { data, error } = await client.from("purchase_orders").select(ORDER_COLUMNS).order("created_at", { ascending: false });
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(orderFromRow);
    },
    async getOrder(id) {
      const { data, error } = await client.from("purchase_orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();
      if (error) raise(error);
      return data ? orderFromRow(data as Row) : null;
    },
    async saveDraft(draft) {
      const payload = { kind: draft.kind, project_id: draft.kind === "project" ? draft.projectId : null, budget_code: draft.kind === "project" ? draft.budgetCode : null,
        advance_required: draft.advanceRequired, advance_pct: draft.advanceRequired ? draft.advancePct : null, prepay_required: draft.prepayRequired, title: draft.title.trim(), department: draft.department.trim(), needed_by: draft.neededBy, delivery_address: draft.deliveryAddress.trim(), supplier: draft.supplier.trim(), supplier_contact: draft.supplierContact.trim(), note: draft.note.trim() };
      let id = draft.id;
      if (id) await check(client.from("purchase_orders").update(payload).eq("id", id));
      else {
        const { data, error } = await client.from("purchase_orders").insert({ ...payload, code: "tam", status: "draft" }).select("id").single();
        if (error) raise(error);
        id = str((data as Row).id);
      }
      await check(client.from("purchase_items").delete().eq("order_id", id));
      if (draft.items.length) await check(client.from("purchase_items").insert(draft.items.map((item, index) => ({ order_id: id, sort: index, name: item.name.trim(), spec: item.spec.trim(), unit: item.unit.trim(), quantity: item.quantity, unit_price: item.unitPrice }))));
      const saved = await this.getOrder(id);
      if (!saved) throw new Error("PO_NOT_FOUND");
      return saved;
    },
    async deleteDraft(id) { await check(client.from("purchase_orders").delete().eq("id", id)); },
    async listPayments(orderId) {
      const { data, error } = await client.from("purchase_payments").select("*").eq("order_id", orderId).order("requested_at");
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(paymentFromRow);
    },
    async listPendingPayments() {
      const { data, error } = await client.from("purchase_payments").select("*").in("status", ["requested", "approved"]).order("requested_at");
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(paymentFromRow);
    },
    async listEvents(orderId) {
      const { data, error } = await client.from("purchase_events").select("*").eq("order_id", orderId).order("at");
      if (error) raise(error);
      return ((data ?? []) as Row[]).map((row): PurchaseEvent => ({ id: str(row.id), orderId: str(row.order_id), at: str(row.at), actorName: str(row.actor_name), action: str(row.action), note: str(row.note) }));
    },

    async submit(id) { await rpc("purchase_submit", { p_order: id }); },
    async decide(id, approve, note) { await rpc("purchase_decide", { p_order: id, p_approve: approve, p_note: note }); },
    async markOrdered(id, supplier, contact, expected, note) { await rpc("purchase_mark_ordered", { p_order: id, p_supplier: supplier, p_contact: contact, p_expected: expected, p_note: note }); },
    async track(id, note, expected) { await rpc("purchase_track", { p_order: id, p_note: note, p_expected: expected }); },
    async requestPayment(id, input) {
      await rpc("purchase_request_rfp", { p_order: id, p_kind: input.kind, p_amount: input.amount, p_vat: input.vatAmount, p_invoice_no: input.invoiceNo, p_invoice_date: input.invoiceDate, p_payee: input.payee, p_note: input.note });
    },
    async decidePayment(paymentId, approve, note) { await rpc("purchase_decide_payment", { p_payment: paymentId, p_approve: approve, p_note: note }); },
    async pay(paymentId, method, note) { await rpc("purchase_pay", { p_payment: paymentId, p_method: method, p_note: note }); },
    async receive(id, lines, note, record) {
      await rpc("purchase_receive_record", { p_order: id, p_items: lines, p_note: note, p_record_no: record?.recordNo ?? "", p_signed_both: record?.signedByBoth ?? false });
    },
    async issuePo(id, supplier, contact) { await rpc("purchase_issue_po", { p_order: id, p_supplier: supplier, p_contact: contact }); },
    async supplierAccept(id, note) { await rpc("purchase_supplier_accept", { p_order: id, p_note: note }); },
    async complete(id, note) { await rpc("purchase_complete", { p_order: id, p_note: note }); },
    async cancel(id, note) { await rpc("purchase_cancel", { p_order: id, p_note: note }); },

    async costCodes() {
      const { data, error } = await client.from("cost_codes").select("code, name").eq("active", true).order("code");
      if (error) raise(error);
      return ((data ?? []) as Row[]).flatMap((row): CostCode[] => { const group = groupOf(str(row.code)); return group ? [{ code: str(row.code), name: str(row.name), group }] : []; });
    },
    async listBudgetSheets(projectId) {
      const { data, error } = await client.from("project_budget_sheets").select("*, project_budget_lines(*)").eq("project_id", projectId).order("revision", { ascending: false });
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(sheetFromRow);
    },
    async newBudgetSheet(projectId) { return str(await rpc("budget_sheet_new", { p_project: projectId })); },
    async saveBudgetSheet(id, header, lines) { await rpc("budget_sheet_save", { p_sheet: id, p_header: header, p_lines: lines }); },
    async submitBudgetSheet(id) { await rpc("budget_sheet_submit", { p_sheet: id }); },
    async deleteBudgetSheet(id) { await rpc("budget_sheet_delete", { p_sheet: id }); },
    async checkBudget(projectId, code, orderId) {
      const row = ((await rpc("purchase_budget_check", { p_project: projectId, p_code: code, p_order: orderId })) as Row[] | null)?.[0];
      return row && row.sheet_id ? { sheetNumber: str(row.sheet_number), a: num(row.budget_a), b: num(row.ordered_b) } : null;
    },
    async listSteps(docType, docId) {
      return (((await rpc("approval_steps_of", { p_type: docType, p_doc: docId })) ?? []) as Row[]).map((row) => ({
        id: str(row.id), docType, docId, seq: num(row.seq), role: row.role as ApprovalStep["role"], targetDate: str(row.target_date), result: row.result as ApprovalStep["result"],
        signerName: str(row.signer_name), note: str(row.note), actedAt: strOrNull(row.acted_at), canSign: Boolean(row.can_sign),
        ...(row.assignee_name ? { assigneeName: str(row.assignee_name) } : {}),
      }));
    },
    async sign(stepId, approve, note) { await rpc("approval_sign", { p_step: stepId, p_approve: approve, p_note: note }); },
    async myApprovals() {
      return (((await rpc("my_approvals", {})) ?? []) as Row[]).map((row) => ({
        stepId: str(row.step_id), docType: row.doc_type as ApprovalStep["docType"], docId: str(row.doc_id), projectId: strOrNull(row.project_id), projectCode: str(row.project_code),
        title: str(row.title), amount: num(row.amount), role: row.role as ApprovalStep["role"], targetDate: str(row.target_date),
        ...(row.order_id ? { orderId: str(row.order_id) } : {}),
      }));
    },
    async departments() {
      return (((await rpc("procurement_departments", {})) ?? []) as Row[]).map((row) => ({ department: row.department as Department, employeeId: str(row.employee_id), name: str(row.name) }));
    },
    async setDepartments(members) { await check(client.from("procurement_settings").update({ departments: members, updated_at: new Date().toISOString() }).eq("id", 1)); },

    async listExplanatory(projectId) {
      const { data, error } = await client.from("explanatory_reports").select("*, explanatory_report_lines(*)").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(reportFromRow);
    },
    async saveExplanatory(draft) {
      return str(await rpc("explanatory_save", { p_id: draft.id ?? null, p_project: draft.projectId, p_data: { kind: draft.kind, warrantyDoneOn: draft.warrantyDoneOn ?? "", explanation: draft.explanation, attachments: draft.attachments, orderId: draft.orderId ?? "", lines: draft.lines } }));
    },
    async submitExplanatory(id) { await rpc("explanatory_submit", { p_id: id }); },
    async deleteExplanatory(id) { await rpc("explanatory_delete", { p_id: id }); },

    async listMaterialRequests(projectId) {
      const { data, error } = await client.from("material_requests").select("*, material_request_items(*), purchase_orders(id)").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(requestFromRow);
    },
    async saveMaterialRequest(draft) {
      return str(await rpc("material_request_save", { p_id: draft.id ?? null, p_project: draft.projectId, p_data: {
        requestedOn: draft.requestedOn, note: draft.note,
        items: draft.items.map((item) => ({ id: /^[0-9a-f-]{36}$/i.test(item.id) ? item.id : "", name: item.name, spec: item.spec, maker: item.maker, unit: item.unit, quantity: item.quantity, neededOn: item.neededOn ?? "", note: item.note, budgetCode: item.budgetCode ?? "" })),
      } }));
    },
    async submitMaterialRequest(id) { await rpc("material_request_submit", { p_id: id }); },
    async deleteMaterialRequest(id) { await rpc("material_request_delete", { p_id: id }); },
    async closeMaterialRequest(id, note) { await rpc("material_request_close", { p_id: id, p_note: note }); },
    async setMaterialCodes(id, codes) { await rpc("material_request_codes", { p_id: id, p_codes: Object.fromEntries(Object.entries(codes).map(([key, value]) => [key, value ?? ""])) }); },
    async listQuotes(requestId) {
      const { data, error } = await client.from("material_quotes").select("*").eq("request_id", requestId).order("created_at");
      if (error) raise(error);
      return ((data ?? []) as Row[]).map((row): MaterialQuote => ({
        id: str(row.id), requestId: str(row.request_id), supplier: str(row.supplier), supplierContact: str(row.supplier_contact), quoteRef: str(row.quote_ref), quoteDate: strOrNull(row.quote_date),
        deliveryDays: row.delivery_days === null || row.delivery_days === undefined ? null : num(row.delivery_days), paymentTerms: str(row.payment_terms), note: str(row.note),
        prices: Object.fromEntries(Object.entries((row.prices ?? {}) as Record<string, unknown>).map(([key, value]) => [key, num(value)])), selected: Boolean(row.selected), createdAt: str(row.created_at),
      }));
    },
    async saveQuote(draft) {
      return str(await rpc("material_quote_save", { p_id: draft.id ?? null, p_request: draft.requestId, p_data: {
        supplier: draft.supplier, supplierContact: draft.supplierContact, quoteRef: draft.quoteRef, quoteDate: draft.quoteDate ?? "", deliveryDays: draft.deliveryDays ?? "", paymentTerms: draft.paymentTerms, note: draft.note, prices: draft.prices,
      } }));
    },
    async deleteQuote(id) { await rpc("material_quote_delete", { p_id: id }); },
    async ordersFromQuote(requestId, quoteId) { return (((await rpc("material_quote_to_orders", { p_request: requestId, p_quote: quoteId })) ?? []) as unknown[]).map(str); },

    async listContracts(projectId) {
      const { data, error } = await client.from("project_contracts").select("*").eq("project_id", projectId).order("revision", { ascending: false });
      if (error) raise(error);
      return ((data ?? []) as Row[]).map(contractFromRow);
    },
    async newContract(projectId) { return str(await rpc("contract_new", { p_project: projectId })); },
    async saveContract(id, draft) {
      await rpc("contract_save", { p_id: id, p_data: { ...draft, quoteDate: draft.quoteDate ?? "", customerDocDate: draft.customerDocDate ?? "", startOn: draft.startOn ?? "", endOn: draft.endOn ?? "" } });
    },
    async submitContract(id) { await rpc("contract_submit", { p_id: id }); },
    async deleteContract(id) { await rpc("contract_delete", { p_id: id }); },
  };
}
