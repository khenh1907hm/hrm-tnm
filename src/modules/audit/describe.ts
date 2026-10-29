import type { AuditEvent } from "./types";

/** Tên thao tác dễ đọc; thao tác chưa có tên thì hiện mã gốc. */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  "employee.create": "Thêm nhân sự",
  "employee.import": "Nhập nhân sự từ Excel",
  "employee.update": "Sửa hồ sơ nhân sự",
  "employee.extra.update": "Sửa thông tin bổ sung",
  "employee.archive": "Lưu trữ hồ sơ",
  "employee.restore": "Khôi phục hồ sơ",
  "employee.roster.export": "Xuất Excel danh sách nhân sự",
  "cccd.reveal": "Xem CCCD đầy đủ",
  "certificate.add": "Thêm chứng chỉ",
  "certificate.update": "Sửa chứng chỉ",
  "certificate.renew": "Gia hạn chứng chỉ",
  "certificate.attachments.update": "Sửa tệp đính kèm chứng chỉ",
  "certificate.archive": "Ẩn chứng chỉ",
  "certificate.restore": "Khôi phục chứng chỉ",
  "commander.create": "Thêm chỉ huy trưởng",
  "commander.update": "Sửa chỉ huy trưởng",
  "commander.archive": "Ẩn chỉ huy trưởng",
  "signature.add": "Thêm chữ ký",
  "signature.update": "Sửa chữ ký",
  "signature.remove": "Xóa chữ ký",
  "settings.update": "Sửa cài đặt email",
  "reminder.sent": "Gửi email nhắc hạn",
  "account.create": "Thêm tài khoản",
  "account.role": "Đổi vai trò tài khoản",
  "account.update": "Sửa tài khoản",
  "account.password": "Đặt lại mật khẩu",
  "account.lock": "Khóa tài khoản",
  "account.unlock": "Mở khóa tài khoản",
};

export const AUDIT_ENTITY_LABELS: Readonly<Record<string, string>> = {
  employee: "Nhân sự", certificate: "Chứng chỉ", commander: "Chỉ huy trưởng", signature: "Chữ ký", settings: "Cài đặt", account: "Tài khoản",
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  code: "Mã nhân viên", name: "Họ tên", dob: "Ngày sinh", gender: "Giới tính", cccd: "CCCD", phone: "Điện thoại",
  home: "Nguyên quán", address: "Thường trú", currentAddress: "Địa chỉ hiện tại", position: "Chức danh", group: "Nhóm",
  startDate: "Ngày nhận việc", endDate: "Ngày nghỉ việc", status: "Trạng thái", photo: "Ảnh 3×4",
  emergencyContactId: "Người liên hệ khẩn cấp", archiveReason: "Lý do lưu trữ", archivedAt: "Ngày lưu trữ",
  cccdMismatchOverrideReason: "Lý do ghi đè CCCD", extraFields: "Thông tin bổ sung", extraFiles: "Ảnh bổ sung",
  type: "Loại", title: "Tên chứng chỉ", number: "Số", issueDate: "Ngày cấp", expiryDate: "Ngày hết hạn",
  document: "Tệp chính", supplementaryFiles: "Tệp bổ sung", state: "Tình trạng", safetyGroup: "Nhóm an toàn",
  label: "Nhãn", file: "Tệp", reminderEmails: "Email nhận nhắc hạn", sendExpiredNotice: "Nhắc cả chứng chỉ đã hết hạn",
  role: "Vai trò", email: "Email", fullName: "Họ tên", locked: "Đã khóa",
};

/** Trường kỹ thuật, không cần hiện khi so sánh (expectedVersion lọt vào bản ghi cũ từ dữ liệu nhập). */
const HIDDEN_FIELDS = new Set(["id", "version", "expectedVersion", "excludeId", "replacedBy", "archivedBy", "employeeId", "mismatchOverrideReason"]);
/** Trống theo nghĩa người đọc: không có, null hay chuỗi rỗng đều như nhau. */
const comparable = (value: unknown): string => JSON.stringify(value === undefined || value === "" ? null : value);
const VALUE_LABELS: Readonly<Record<string, string>> = {
  active: "Đang làm việc", on_leave: "Tạm nghỉ", resigned: "Đã nghỉ việc", current: "Hiện hành", replaced: "Đã thay thế", archived: "Đã ẩn",
};

export type AuditChange = { field: string; label: string; before: string; after: string };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Giá trị gọn để hiện trong bảng. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "(ảnh)";
    return VALUE_LABELS[value] ?? (value.length > 120 ? `${value.slice(0, 117)}…` : value);
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join(", ") : "(trống)";
  if (isRecord(value)) {
    // Tham chiếu tệp: hiện tên tệp
    if (typeof value.name === "string" && typeof value.mime === "string") return value.name;
    if (isRecord(value.file) && typeof value.file.name === "string") return `${value.label ?? value.file.name}`;
    const entries = Object.entries(value).filter(([key]) => !HIDDEN_FIELDS.has(key));
    return entries.length ? entries.map(([key, item]) => `${FIELD_LABELS[key] ?? key}: ${formatAuditValue(item)}`).join("; ") : "(trống)";
  }
  return String(value);
}

/** Thao tác chỉ đọc/gửi: before/after là thông tin kèm theo, không phải dữ liệu bị đổi. */
const NO_DIFF_ACTIONS = new Set(["cccd.reveal", "employee.roster.export", "reminder.sent"]);

/** Các trường đổi giữa bản trước và bản sau (chỉ so cấp ngoài cùng). */
export function auditChanges(event: Pick<AuditEvent, "before" | "after"> & { action?: string }): AuditChange[] {
  if (event.action && NO_DIFF_ACTIONS.has(event.action)) return [];
  const before = isRecord(event.before) ? event.before : {};
  const after = isRecord(event.after) ? event.after : {};
  if (!isRecord(event.before) && !isRecord(event.after)) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !HIDDEN_FIELDS.has(key));
  return keys
    .filter((key) => comparable(before[key]) !== comparable(after[key]))
    .map((key) => ({ field: key, label: FIELD_LABELS[key] ?? key, before: formatAuditValue(before[key]), after: formatAuditValue(after[key]) }));
}

/** Tên đối tượng bị tác động: tên nhân sự, số chứng chỉ... lấy từ bản sau (hoặc bản trước khi đã xóa). */
export function auditSubject(event: Pick<AuditEvent, "before" | "after" | "entityType" | "entityId">): string {
  const doc = isRecord(event.after) ? event.after : isRecord(event.before) ? event.before : null;
  if (doc) {
    if (event.entityType === "employee" && typeof doc.name === "string") return typeof doc.code === "string" ? `${doc.name} (${doc.code})` : doc.name;
    if (event.entityType === "certificate" && typeof doc.number === "string") return `Số ${doc.number}`;
    if (event.entityType === "account" && typeof doc.email === "string") return doc.email;
    if (typeof doc.name === "string") return doc.name;
    if (typeof doc.label === "string") return doc.label;
  }
  return event.entityType === "settings" ? "Cài đặt chung" : event.entityId;
}

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;

/**
 * Bản sao để ghi nhật ký: bỏ mọi chuỗi data URL (ảnh base64) để nhật ký không phình theo ảnh.
 * Ảnh thật đã nằm trong kho tệp; nhật ký chỉ cần biết là có ảnh.
 */
export function stripDataUrls(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("data:") ? "data:(đã lược bỏ)" : value;
  if (Array.isArray(value)) return value.map(stripDataUrls);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripDataUrls(item)]));
  return value;
}
