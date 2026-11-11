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

/** ATT-03: ai duyệt phiếu: PM của dự án hoặc Admin; chỉ phiếu đang chờ; từ chối phải ghi lý do. */
export function canReview(request: Pick<AttendanceRequest, "status">, viewer: { isPm: boolean }): boolean {
  return viewer.isPm && request.status === "pending";
}
