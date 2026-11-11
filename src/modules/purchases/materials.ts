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
  projectId: string;
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
    department: "", neededBy: items.map((item) => item.neededOn).filter((day): day is string => Boolean(day)).sort()[0] ?? null, deliveryAddress: projectAddress, supplier: quote.supplier, supplierContact: quote.supplierContact,
    note: [`Theo phiếu ${request.number}`, quote.quoteRef ? `báo giá ${quote.quoteRef}` : "", quote.paymentTerms ? `ĐK thanh toán: ${quote.paymentTerms}` : ""].filter(Boolean).join(" · "),
    advanceRequired: false, advancePct: null, prepayRequired: false,
    items: items.map((item) => ({ id: "", name: item.name, spec: [item.spec, item.maker].filter(Boolean).join(" · "), unit: item.unit, quantity: item.quantity, unitPrice: quote.prices[item.id] ?? 0 })),
  }));
}
