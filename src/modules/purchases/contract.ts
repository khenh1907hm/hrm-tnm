/**
 * Xác nhận dự án (biểu mẫu P-COST-01): giá trị hợp đồng, điều khoản thanh toán của khách, xác nhận / xác nhận tạm.
 * Đặc tả: docs/dac-ta-mua-hang-du-an.md mục 3.1, quy tắc PRC-60..PRC-62.
 */
import type { Confirmation } from "./budget";

export type ContractStatus = "draft" | "submitted" | "approved" | "rejected" | "superseded";
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = { draft: "Nháp", submitted: "Đang ký duyệt", approved: "Đã duyệt", rejected: "Bị trả về", superseded: "Đã thay bằng lần sửa mới" };

export type ContractAttachments = { signedQuoteOrPo: boolean; stampedQuote: boolean; customerInstruction: boolean; masterSchedule: boolean; drawings: boolean };
export const CONTRACT_ATTACHMENT_LABELS: Record<keyof ContractAttachments, string> = {
  signedQuoteOrPo: "Báo giá có ký xác nhận hoặc PO / Hợp đồng",
  stampedQuote: "Báo giá TNM gửi có ký đóng dấu",
  customerInstruction: "Thông tin hướng dẫn từ khách hàng (email, PM ký xác nhận báo giá)",
  masterSchedule: "Tiến độ tổng",
  drawings: "Bản vẽ",
};
/** Hồ sơ cần theo từng trường hợp (in trên mẫu). */
export const REQUIRED_ATTACHMENTS: Record<Confirmation, readonly (keyof ContractAttachments)[]> = {
  confirmed: ["signedQuoteOrPo", "stampedQuote", "masterSchedule", "drawings"],
  tentative: ["stampedQuote", "customerInstruction", "masterSchedule", "drawings"],
};
export const noContractAttachments = (): ContractAttachments => ({ signedQuoteOrPo: false, stampedQuote: false, customerInstruction: false, masterSchedule: false, drawings: false });

export type ProjectContract = {
  id: string;
  projectId: string;
  revision: number;
  status: ContractStatus;
  confirmation: Confirmation;
  issuedOn: string;
  description: string;
  quoteNo: string;
  quoteDate: string | null;
  quoteValue: number;
  /** Giá trị xác nhận = giá trị hợp đồng (dùng cho ngân sách và lợi nhuận). */
  confirmedValue: number;
  customerDocNo: string;
  customerDocDate: string | null;
  paymentTerms: string;
  customerName: string;
  ownerName: string;
  startOn: string | null;
  endOn: string | null;
  attachments: ContractAttachments;
  note: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
};
export type ContractDraft = Omit<ProjectContract, "id" | "projectId" | "revision" | "status" | "createdAt" | "submittedAt" | "approvedAt">;

export const contractDraftOf = (contract: ProjectContract): ContractDraft => {
  const { id: _id, projectId: _p, revision: _r, status: _s, createdAt: _c, submittedAt: _sa, approvedAt: _aa, ...draft } = contract;
  return draft;
};

/** PRC-60: kiểm tra trước khi lưu / gửi ký. */
export function contractIssue(draft: ContractDraft, submitting: boolean): string | null {
  if ([draft.quoteValue, draft.confirmedValue].some((value) => !Number.isInteger(value) || value < 0)) return "BUDGET_BAD_AMOUNT";
  if (draft.startOn && draft.endOn && draft.endOn < draft.startOn) return "CONTRACT_BAD_DATES";
  if (!submitting) return null;
  if (!(draft.confirmedValue > 0)) return "CONTRACT_VALUE_REQUIRED";
  if (draft.customerName.trim().length < 2) return "CONTRACT_CUSTOMER_REQUIRED";
  // Xác nhận chính thức phải có chứng từ của khách (PO / hợp đồng / báo giá có ký xác nhận)
  if (draft.confirmation === "confirmed" && !draft.customerDocNo.trim() && !draft.attachments.signedQuoteOrPo) return "CONTRACT_CUSTOMER_DOC_REQUIRED";
  return null;
}

/** Hồ sơ còn thiếu theo trường hợp xác nhận. */
export const missingAttachments = (draft: Pick<ContractDraft, "confirmation" | "attachments">) => REQUIRED_ATTACHMENTS[draft.confirmation].filter((key) => !draft.attachments[key]);
