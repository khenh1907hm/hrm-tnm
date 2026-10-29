import type { createHrApp } from "../../app-core/createHrApp";
import { messagesVi } from "../../messages.vi";
import type { EmployeeInput } from "../../modules/employees/types";
import type { OcrFormField } from "../../modules/ocr/applyOcrToForm";

export type App = ReturnType<typeof createHrApp>;
export type PageView = "employees" | "alerts" | "signatures" | "settings" | "reports" | "skills" | "tools" | "audit";
export type { Notify as SetNotice } from "./Toast";
export type SignatureRow = import("../../modules/signatures/types").Signature;
export type ExpiringCertificateRow = { id: string; employeeId: string; employeeName?: string; employeeCode?: string; number: string; expiryDate: string; reminderSendDate: string; reminderSent: boolean; reminderSentDate?: string | null; type: string; displayName?: string; daysLeft: number; group: string };

export const emptyEmployee: EmployeeInput = {
  code: "", name: "", dob: "", gender: "Nam", cccd: "", phone: "", home: "", address: "", currentAddress: "",
  position: "Nhân viên hiện trường", group: null, startDate: "", emergencyContactId: null, status: "active", endDate: null,
  photo: null,
};

export function issueText(code: string): string { return messagesVi[code] ?? "Thông tin chưa hợp lệ."; }

export function ocrFieldLabel(field: OcrFormField): string {
  const labels: Record<OcrFormField, string> = { name: "Họ và tên", dob: "Ngày sinh", gender: "Giới tính", cccd: "Số căn cước công dân", phone: "Điện thoại", home: "Nguyên quán", address: "Địa chỉ thường trú", currentAddress: "Địa chỉ hiện tại" };
  return labels[field];
}

export function readinessFieldLabel(field: string): string {
  const labels: Record<string, string> = { name: "Họ và tên", dob: "Ngày sinh", gender: "Giới tính", home: "Nguyên quán", address: "Địa chỉ thường trú", currentAddress: "Địa chỉ hiện tại", phone: "Điện thoại", startDate: "Ngày làm nghề", companyStartDate: "Ngày vào TNM", emergencyContactId: "Người liên hệ khẩn cấp", signDate: "Ngày ký", signerId: "Người ký", employeeId: "Hồ sơ nhân sự" };
  return labels[field] ?? field;
}
