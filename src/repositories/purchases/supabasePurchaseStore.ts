import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseStore } from "../../modules/purchases/store";
import type { PurchaseEvent, PurchaseItem, PurchaseOrder, PurchasePayment } from "../../modules/purchases/types";

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
});
const paymentFromRow = (row: Row): PurchasePayment => ({ id: str(row.id), orderId: str(row.order_id), kind: row.kind as PurchasePayment["kind"], amount: num(row.amount), payee: str(row.payee), note: str(row.note), status: row.status as PurchasePayment["status"], requestedAt: str(row.requested_at), approvedAt: strOrNull(row.approved_at), paidAt: strOrNull(row.paid_at), paidMethod: str(row.paid_method), decisionNote: str(row.decision_note) });
const ORDER_COLUMNS = "*, purchase_items(*)";

/** Store đặt hàng chế độ thật: đọc qua RLS, mọi bước chuyển trạng thái gọi hàm purchase_* ở máy chủ. */
export function createSupabasePurchaseStore(client: SupabaseClient): PurchaseStore {
  const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await client.rpc(name, args); if (error) raise(error); return data as unknown; };
  const check = async (request: PromiseLike<{ error: PostgrestError | null }>) => { const { error } = await request; if (error) raise(error); };
  return {
    mode: "live",
    async myUserId() { const { data } = await client.auth.getUser(); return data.user?.id ?? ""; },
    async myRoles() {
      const row = ((await rpc("purchase_my_roles", {})) as Row[] | null)?.[0];
      return { isApprover: Boolean(row?.is_approver), isPayer: Boolean(row?.is_payer), seesAll: Boolean(row?.sees_all) };
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
      const payload = { kind: draft.kind, project_id: draft.kind === "project" ? draft.projectId : null, title: draft.title.trim(), department: draft.department.trim(), needed_by: draft.neededBy, delivery_address: draft.deliveryAddress.trim(), supplier: draft.supplier.trim(), supplier_contact: draft.supplierContact.trim(), note: draft.note.trim() };
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
    async requestPayment(id, kind, amount, payee, note) { await rpc("purchase_request_payment", { p_order: id, p_kind: kind, p_amount: amount, p_payee: payee, p_note: note }); },
    async decidePayment(paymentId, approve, note) { await rpc("purchase_decide_payment", { p_payment: paymentId, p_approve: approve, p_note: note }); },
    async pay(paymentId, method, note) { await rpc("purchase_pay", { p_payment: paymentId, p_method: method, p_note: note }); },
    async receive(id, lines, note) { await rpc("purchase_receive", { p_order: id, p_items: lines, p_note: note }); },
    async complete(id, note) { await rpc("purchase_complete", { p_order: id, p_note: note }); },
    async cancel(id, note) { await rpc("purchase_cancel", { p_order: id, p_note: note }); },
  };
}
