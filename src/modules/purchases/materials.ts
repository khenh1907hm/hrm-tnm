/**
 * Phiếu yêu cầu vật tư (biểu mẫu P-COST-08), hỏi giá nhà cung cấp và bảng so sánh, rồi lên đơn đặt hàng nháp (P-CC-07).
 * Đặc tả: docs/dac-ta-mua-hang-du-an.md mục 3.3, 3.4, quy tắc PRC-50..PRC-55.
 */
import { DEFAULT_COST_CODES, groupOf, type CostCode } from "./budget";
import type { PurchaseDraft } from "./types";

export type MaterialRequestStatus = "draft" | "submitted" | "approved" | "rejected" | "ordered" | "closed";
export const MATERIAL_STATUS_LABELS: Record<MaterialRequestStatus, string> = {
  draft: "Nháp", submitted: "Đang ký duyệt", approved: "Đã duyệt · đang hỏi giá", rejected: "Bị trả về", ordered: "Đã lên đơn", closed: "Đã đóng",
};

export type MaterialItem = {
  id: string;
  name: string;
  spec: string;
  maker: string;
  unit: string;
  quantity: number;
  neededOn: string | null;
  note: string;
  /** Mã ngân sách dự kiến; công trường không biết thì để trống, P. Vật tư điền khi hỏi giá. */
  budgetCode: string | null;
};

export type MaterialRequest = {
  id: string;
  /** null: phiếu của Văn phòng (YCVT-VP-…), không chia mã ngân sách. */
  projectId: string | null;
  /** Số phiếu: YCVT-<số dự án>-<3 số>. */
  number: string;
  requesterName: string;
  requestedOn: string;
  status: MaterialRequestStatus;
  note: string;
  items: MaterialItem[];
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Các đơn đặt hàng đã lập từ phiếu này. */
  orderIds: string[];
};
export type MaterialRequestDraft = Pick<MaterialRequest, "projectId" | "requestedOn" | "note"> & { id?: string; items: MaterialItem[] };

/** Báo giá của một nhà cung cấp cho phiếu: đơn giá theo từng dòng vật tư (0 = không báo giá dòng đó). */
export type MaterialQuote = {
  id: string;
  requestId: string;
  supplier: string;
  supplierContact: string;
  quoteRef: string;
  quoteDate: string | null;
  deliveryDays: number | null;
  paymentTerms: string;
  note: string;
  prices: Record<string, number>;
  /** Đã chọn để lên đơn. */
  selected: boolean;
  createdAt: string;
};
export type MaterialQuoteDraft = Omit<MaterialQuote, "id" | "selected" | "createdAt"> & { id?: string };

export const materialNumber = (projectCode: string, seq: number) => `YCVT-${projectCode}-${String(seq).padStart(3, "0")}`;

/** PRC-50: kiểm tra phiếu trước khi lưu / gửi. */
export function materialIssue(draft: Pick<MaterialRequestDraft, "items">, submitting: boolean, catalog: readonly CostCode[] = DEFAULT_COST_CODES): string | null {
  for (const item of draft.items) {
    if (item.name.trim().length < 2) return "MR_ITEM_NAME_REQUIRED";
    if (!(item.quantity > 0) || !Number.isFinite(item.quantity)) return "MR_BAD_QUANTITY";
    if (item.budgetCode && !catalog.some((code) => code.code === item.budgetCode)) return "BUDGET_UNKNOWN_CODE";
  }
  if (submitting && !draft.items.length) return "MR_NO_ITEMS";
  if (submitting && draft.items.some((item) => !item.unit.trim())) return "MR_UNIT_REQUIRED";
  return null;
}

/** Thành tiền một báo giá (chỉ các dòng có giá). */
export const quoteTotal = (quote: Pick<MaterialQuote, "prices">, items: readonly MaterialItem[]) =>
  items.reduce((sum, item) => sum + Math.round((quote.prices[item.id] ?? 0) * item.quantity), 0);
export const quotedCount = (quote: Pick<MaterialQuote, "prices">, items: readonly MaterialItem[]) => items.filter((item) => (quote.prices[item.id] ?? 0) > 0).length;

/** Nhà cung cấp rẻ nhất cho từng dòng (id báo giá), để tô trên bảng so sánh. */
export function cheapestByItem(quotes: readonly MaterialQuote[], items: readonly MaterialItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    let best: MaterialQuote | null = null;
    for (const quote of quotes) {
      const price = quote.prices[item.id] ?? 0;
      if (price > 0 && (!best || price < (best.prices[item.id] ?? Infinity))) best = quote;
    }
    if (best) out[item.id] = best.id;
  }
  return out;
}

/** Từ mức này trở lên phải có ít nhất 2 báo giá (hoặc ghi lý do chỉ có một nhà cung cấp). */
export const MIN_TWO_QUOTES_FROM = 50_000_000;
/** PRC-52: cảnh báo khi giá trị lớn mà chỉ có một báo giá. */
export const needsSecondQuote = (quotes: readonly MaterialQuote[], items: readonly MaterialItem[]) =>
  quotes.length < 2 && quotes.some((quote) => quoteTotal(quote, items) >= MIN_TWO_QUOTES_FROM);

/**
 * PRC-53: báo giá được chọn → đơn đặt hàng nháp, mỗi mã ngân sách một đơn (đơn dự án gắn một mã).
 * Chỉ các dòng có giá; dòng chưa có mã ngân sách thì báo lỗi để P. Vật tư điền trước.
 */
export function ordersFromQuote(request: Pick<MaterialRequest, "projectId" | "number" | "items" | "note">, quote: MaterialQuote, projectAddress = ""): PurchaseDraft[] | { error: string } {
  const lines = request.items.filter((item) => (quote.prices[item.id] ?? 0) > 0);
  if (!lines.length) return { error: "MR_QUOTE_EMPTY" };
  if (lines.some((item) => !item.budgetCode || !groupOf(item.budgetCode))) return { error: "MR_ITEM_CODE_REQUIRED" };
  const byCode = new Map<string, MaterialItem[]>();
  for (const item of lines) byCode.set(item.budgetCode!, [...(byCode.get(item.budgetCode!) ?? []), item]);
  return [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, items]) => ({
    kind: "project", projectId: request.projectId, budgetCode: code,
    title: `${request.number} · ${items.length === 1 ? items[0]!.name : `${items[0]!.name} và ${items.length - 1} mục khác`}`.slice(0, 200),
    department: "", neededBy: items.map((item) => item.neededOn).filter((day): day is string => Boolean(day)).sort()[0] ?? null, deliveryAddress: projectAddress, supplier: quote.supplier, supplierContact: quote.supplierContact, supplierAddress: "", supplierPhone: "", supplierEmail: "",
    note: [`Theo phiếu ${request.number}`, quote.quoteRef ? `báo giá ${quote.quoteRef}` : "", quote.paymentTerms ? `ĐK thanh toán: ${quote.paymentTerms}` : ""].filter(Boolean).join(" · "),
    advanceRequired: false, advancePct: null, prepayRequired: false,
    items: items.map((item) => ({ id: "", name: item.name, spec: [item.spec, item.maker].filter(Boolean).join(" · "), unit: item.unit, quantity: item.quantity, unitPrice: quote.prices[item.id] ?? 0 })),
  }));
}

/**
 * YCVT ↔ PO nháp: mỗi hạng mục (mã ngân sách) của phiếu là một PO nháp riêng; văn phòng không chia hạng mục nên cả phiếu một PO.
 * PO nháp trống: chưa NCC, đơn giá 0 — P. Vật tư điền sau (hoặc chọn báo giá để điền tự động).
 */
export function orderFromGroup(request: Pick<MaterialRequest, "projectId" | "number" | "items">, code: string | null, projectAddress = ""): PurchaseDraft | { error: string } {
  const office = request.projectId === null;
  if (!office && !code) return { error: "MR_ITEM_CODE_REQUIRED" };
  const items = request.items.filter((item) => office || item.budgetCode === code);
  if (!items.length) return { error: "MR_GROUP_EMPTY" };
  return {
    kind: office ? "office" : "project", projectId: request.projectId, budgetCode: office ? null : code,
    title: `${request.number} · ${items.length === 1 ? items[0]!.name : `${items[0]!.name} và ${items.length - 1} mục khác`}`.slice(0, 200),
    department: "", neededBy: items.map((item) => item.neededOn).filter((day): day is string => Boolean(day)).sort()[0] ?? null, deliveryAddress: projectAddress,
    supplier: "", supplierContact: "", supplierAddress: "", supplierPhone: "", supplierEmail: "", note: `Theo phiếu ${request.number}`,
    advanceRequired: false, advancePct: null, prepayRequired: false,
    items: items.map((item) => ({ id: "", name: item.name, spec: [item.spec, item.maker].filter(Boolean).join(" · "), unit: item.unit, quantity: item.quantity, unitPrice: 0 })),
  };
}

/** Mọi hạng mục (đã có mã) của phiếu đều đã có PO chưa hủy → phiếu "Đã lên đơn". */
export function allGroupsOrdered(request: Pick<MaterialRequest, "projectId" | "items">, orders: readonly { budgetCode: string | null; status: string }[]): boolean {
  const live = orders.filter((order) => order.status !== "cancelled");
  if (request.projectId === null) return live.length > 0;
  return request.items.filter((item) => item.budgetCode).every((item) => live.some((order) => order.budgetCode === item.budgetCode));
}

/**
 * Tiến độ một phiếu YCVT (hiện ở danh sách và trang chi tiết):
 * Lập phiếu → Ký duyệt → Hỏi giá (nhiều báo giá) → Chọn NCC, lên đơn → Đơn hàng (mua, nhận, thanh toán) → Hoàn tất.
 */
export type MaterialStageKey = "draft" | "signing" | "quoting" | "ordering" | "orders" | "done";
export type MaterialStage = { key: MaterialStageKey; label: string; state: "done" | "current" | "todo" | "bad" | "skipped"; note: string };
export function materialProgress(request: Pick<MaterialRequest, "status">, quoteCount: number, orders: readonly { status: string }[]): MaterialStage[] {
  const { status } = request;
  const signed = status === "approved" || status === "ordered" || status === "closed";
  const finished = orders.filter((order) => order.status === "completed" || order.status === "cancelled").length;
  const allOrdersDone = orders.length > 0 && finished === orders.length;
  const closed = status === "closed";
  const stages: MaterialStage[] = [
    { key: "draft", label: "Lập phiếu", state: status === "draft" ? "current" : status === "rejected" ? "bad" : "done", note: status === "rejected" ? "Bị trả về: sửa và gửi lại" : status === "draft" ? "Đang soạn" : "" },
    { key: "signing", label: "Ký duyệt", state: status === "submitted" ? "current" : signed ? "done" : "todo", note: status === "submitted" ? "Đang chờ ký" : "" },
    { key: "quoting", label: "Hỏi giá", state: status === "approved" && quoteCount === 0 ? "current" : quoteCount > 0 && signed ? "done" : closed ? "skipped" : "todo", note: quoteCount ? `${quoteCount} báo giá` : "" },
    { key: "ordering", label: "Chọn NCC, lên đơn", state: status === "ordered" || orders.length > 0 ? "done" : status === "approved" && quoteCount > 0 ? "current" : closed ? "skipped" : "todo", note: orders.length ? `${orders.length} đơn` : "" },
    { key: "orders", label: "Mua, nhận hàng, thanh toán", state: allOrdersDone ? "done" : orders.length > 0 ? "current" : closed ? "skipped" : "todo", note: orders.length ? `${finished}/${orders.length} đơn xong` : "" },
    { key: "done", label: "Hoàn tất", state: closed || allOrdersDone ? "done" : "todo", note: closed ? "Đã đóng phiếu" : "" },
  ];
  return stages;
}
export const materialCurrentLabel = (stages: readonly MaterialStage[]) => {
  const current = stages.find((stage) => stage.state === "current" || stage.state === "bad");
  if (current) return current.note || current.label;
  return stages[stages.length - 1]!.state === "done" ? "Hoàn tất" : "";
};
