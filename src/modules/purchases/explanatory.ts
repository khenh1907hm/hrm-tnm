/**
 * Báo cáo giải thích (biểu mẫu P-COST-05): xin tăng ngân sách một mã khi đơn vượt ngân sách, đổi mã số, công việc bảo hành.
 * Đặc tả: docs/dac-ta-mua-hang-du-an.md mục 3.9, quy tắc PRC-40..PRC-43.
 */
import { DEFAULT_COST_CODES, type CostCode } from "./budget";

export type ExplanatoryKind = "budget_change" | "warranty" | "other";
export const EXPLANATORY_KIND_LABELS: Record<ExplanatoryKind, string> = {
  budget_change: "Thay đổi bảng ngân sách (vượt số tiền P/O, thay đổi mã số)",
  warranty: "Công việc bảo hành",
  other: "Khác (giải thích rõ)",
};
export type ExplanatoryStatus = "draft" | "submitted" | "approved" | "rejected";
export const EXPLANATORY_STATUS_LABELS: Record<ExplanatoryStatus, string> = { draft: "Nháp", submitted: "Đang ký duyệt", approved: "Đã duyệt", rejected: "Bị trả về" };

/** Một dòng theo mã: A = ngân sách gốc, B = đã đặt hàng, C = cần đặt hàng; D = B + C; E = D − A. */
export type ExplanatoryLine = { code: string; budgetA: number; orderedB: number; neededC: number };
export type ExplanatoryAttachments = { customerRequest: boolean; overQuote: boolean; incident: boolean; drawing: boolean };
export const ATTACHMENT_LABELS: Record<keyof ExplanatoryAttachments, string> = {
  customerRequest: "Yêu cầu từ khách hàng", overQuote: "Báo giá vượt", incident: "Báo cáo sự cố", drawing: "Bản vẽ giải thích",
};
export const noAttachments = (): ExplanatoryAttachments => ({ customerRequest: false, overQuote: false, incident: false, drawing: false });

export type ExplanatoryReport = {
  id: string;
  projectId: string;
  /** Số báo cáo: GT-<số dự án>-<2 số>. */
  number: string;
  kind: ExplanatoryKind;
  /** Ngày hoàn thành (dự án bảo hành). */
  warrantyDoneOn: string | null;
  explanation: string;
  attachments: ExplanatoryAttachments;
  status: ExplanatoryStatus;
  /** Đơn hàng nháp đang bị chặn vì vượt ngân sách (nếu lập từ đơn). */
  orderId: string | null;
  createdByName: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lines: ExplanatoryLine[];
};
export type ExplanatoryDraft = Pick<ExplanatoryReport, "projectId" | "kind" | "warrantyDoneOn" | "explanation" | "attachments" | "orderId" | "lines"> & { id?: string };

export const lineD = (line: ExplanatoryLine) => line.orderedB + line.neededC;
export const lineE = (line: ExplanatoryLine) => lineD(line) - line.budgetA;

export function explanatoryTotals(lines: readonly ExplanatoryLine[]) {
  return lines.reduce((sum, line) => ({ a: sum.a + line.budgetA, b: sum.b + line.orderedB, c: sum.c + line.neededC, d: sum.d + lineD(line), e: sum.e + lineE(line) }), { a: 0, b: 0, c: 0, d: 0, e: 0 });
}

/** PRC-41: phần ngân sách được cộng thêm cho từng mã khi Lãnh đạo duyệt (chỉ các dòng E > 0). */
export const budgetIncrements = (lines: readonly ExplanatoryLine[]) => lines.filter((line) => lineE(line) > 0).map((line) => ({ code: line.code, amount: lineE(line) }));

export const explanatoryNumber = (projectCode: string, seq: number) => `GT-${projectCode}-${String(seq).padStart(2, "0")}`;

/** PRC-40: kiểm tra trước khi lưu / gửi ký. Trả về mã lỗi đầu tiên hoặc null. */
export function explanatoryIssue(draft: Pick<ExplanatoryDraft, "kind" | "warrantyDoneOn" | "explanation" | "lines">, submitting: boolean, catalog: readonly CostCode[] = DEFAULT_COST_CODES): string | null {
  const seen = new Set<string>();
  for (const line of draft.lines) {
    if (!catalog.some((item) => item.code === line.code)) return "BUDGET_UNKNOWN_CODE";
    if (seen.has(line.code)) return "BUDGET_DUPLICATE_CODE";
    seen.add(line.code);
    if ([line.budgetA, line.orderedB, line.neededC].some((value) => !Number.isInteger(value) || value < 0)) return "BUDGET_BAD_AMOUNT";
  }
  if (!submitting) return null;
  if (!draft.lines.length) return "EXP_NO_LINES";
  if (draft.explanation.trim().length < 10) return "EXP_EXPLANATION_REQUIRED";
  if (draft.kind === "warranty" && !draft.warrantyDoneOn) return "EXP_WARRANTY_DATE_REQUIRED";
  return null;
}
