import { addDays } from "../../lib/dates";

/** Phiếu giải trình chấm công (bảng attendance_requests). */
export type RequestKind = "missing_in" | "missing_out" | "wrong_time" | "out_of_range" | "other";
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  missing_in: "Quên chấm Vào",
  missing_out: "Quên chấm Ra",
  wrong_time: "Giờ chấm bị sai",
  out_of_range: "Không chấm được (ngoài công trường, mất mạng, hỏng máy)",
  other: "Lý do khác",
};
/** Lý do chọn sẵn khi gửi từ app điện thoại (cột reason_code); phiếu gửi từ web để trống. */
export type ReasonCode = "forgot" | "outside_work" | "cannot_check" | "wrong_shift" | "other";
export const REASON_CODE_LABELS: Record<ReasonCode, string> = {
  forgot: "Quên chấm công",
  outside_work: "Làm việc công ty ở ngoài",
  cannot_check: "Không chấm công được",
  wrong_shift: "Chọn sai ca",
  other: "Lý do khác",
};
export const reasonCodeOf = (value: unknown): ReasonCode | null => typeof value === "string" && Object.hasOwn(REASON_CODE_LABELS, value) ? value as ReasonCode : null;

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { pending: "Chờ PM duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", cancelled: "Đã hủy" };

export type AttendanceRequest = {
  id: string;
  projectId: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  kind: RequestKind;
  requestedIn: string | null;
  requestedOut: string | null;
  reason: string;
  /** Lý do chọn sẵn (app điện thoại); null với phiếu gửi từ web. */
  reasonCode: ReasonCode | null;
  /** Ảnh đính kèm: đường dẫn trong kho riêng tư attendance-attachments (<dự án>/<auth uid>/<file>). */
  attachments: string[];
  status: RequestStatus;
  reviewerName: string;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt: string;
};

export type RequestInput = { projectId: string; workDate: string; kind: RequestKind; requestedIn: string | null; requestedOut: string | null; reason: string };

/** Số ngày lùi tối đa được gửi giải trình. */
export const REQUEST_MAX_AGE_DAYS = 45;

/**
 * ATT-02: kiểm tra phiếu giải trình trước khi gửi (máy chủ kiểm tra lại trong attendance_request_submit):
 * ngày không ở tương lai và trong 45 ngày gần đây; lý do ít nhất 5 ký tự; quên Vào cần giờ Vào, quên Ra cần giờ Ra,
 * sai giờ cần cả hai; giờ Ra phải sau giờ Vào.
 */
export function requestIssue(input: RequestInput, today: string): string | null {
  if (input.workDate > today) return "TS_FUTURE_DATE";
  if (input.workDate < addDays(today, -REQUEST_MAX_AGE_DAYS)) return "ATR_TOO_OLD";
  if (input.reason.trim().length < 5) return "ATR_REASON_REQUIRED";
  if ((input.kind === "missing_in" || input.kind === "wrong_time") && !input.requestedIn) return "ATR_TIME_REQUIRED";
  if ((input.kind === "missing_out" || input.kind === "wrong_time") && !input.requestedOut) return "ATR_TIME_REQUIRED";
  if (input.requestedIn && input.requestedOut && input.requestedOut <= input.requestedIn) return "ATR_TIME_ORDER";
  return null;
}

/**
 * Phần ghi chú của lý do: app điện thoại ghi cột reason là "<nhãn lý do>: <ghi chú> (kèm N ảnh)"; khi đã hiện nhãn và ảnh
 * riêng thì bỏ phần lặp lại đó. Phiếu gửi từ web (không có reason_code) giữ nguyên.
 */
export function reasonNote(request: Pick<AttendanceRequest, "reason" | "reasonCode">): string {
  if (!request.reasonCode) return request.reason;
  let note = request.reason.replace(/\s*\(kèm \d+ ảnh\)$/, "");
  const label = REASON_CODE_LABELS[request.reasonCode];
  if (note.startsWith(label)) note = note.slice(label.length).replace(/^:\s*/, "");
  return note.trim();
}

/** ATT-03: ai duyệt phiếu: PM của dự án hoặc Admin; chỉ phiếu đang chờ; từ chối phải ghi lý do. */
export function canReview(request: Pick<AttendanceRequest, "status">, viewer: { isPm: boolean }): boolean {
  return viewer.isPm && request.status === "pending";
}
