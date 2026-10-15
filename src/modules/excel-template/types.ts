import type { Employee } from "../employees/types";

export type ExcelFieldKey =
  | "code"
  | "name"
  | "dob"
  | "gender"
  | "cccd"
  | "phone"
  | "home"
  | "address"
  | "currentAddress"
  | "position"
  | "group"
  | "startDate"
  | "status";

export interface ExcelFieldDefinition {
  key: ExcelFieldKey;
  label: string;
  example: string;
}

export const AVAILABLE_REPORT_FIELDS: ExcelFieldDefinition[] = [
  { key: "name", label: "Họ và tên", example: "Nguyễn Văn An" },
  { key: "code", label: "Mã nhân viên", example: "NV-001" },
  { key: "dob", label: "Ngày sinh", example: "15/08/1990" },
  { key: "gender", label: "Giới tính", example: "Nam" },
  { key: "cccd", label: "Số CCCD", example: "034090001234" },
  { key: "phone", label: "Số điện thoại", example: "0912345678" },
  { key: "home", label: "Nguyên quán (Quê quán)", example: "Xã Hoằng Phú, Tỉnh Thanh Hóa" },
  { key: "address", label: "Địa chỉ thường trú", example: "Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng" },
  { key: "currentAddress", label: "Địa chỉ hiện tại", example: "Số 12 Ngõ 34, TP. Hà Nội" },
  { key: "position", label: "Chức vụ / Vị trí", example: "Công nhân bậc 3" },
  { key: "group", label: "Nhóm an toàn", example: "Nhóm 3" },
  { key: "startDate", label: "Ngày bắt đầu làm việc", example: "01/01/2024" },
  { key: "status", label: "Trạng thái", example: "Đang làm việc" },
];

export interface ExcelCellMapping {
  cell: string;
  field: ExcelFieldKey;
}

export type ProfileCustomFieldKind = "text" | "date" | "checkbox";
export interface ProfileCustomField {
  key: string;
  label: string;
  kind: ProfileCustomFieldKind;
  /** Giá trị dùng chung (ISO yyyy-mm-dd với kiểu ngày, "true"/"" với ô đánh dấu); sửa được khi xuất. */
  defaultValue: string;
}
export interface ProfileImageSlot {
  field: string;
  range: string;
  /** "cover" cắt ảnh cho kín khung (ảnh 3×4); "contain" co vừa khung. */
  fit: "contain" | "cover";
}
/** Cấu hình "Mẫu hồ sơ": file thiết kế có ô {{trường}}, vùng ảnh và chứng chỉ đính kèm. */
export interface ProfileTemplateConfig {
  sheetName: string;
  printArea: string;
  placeholders: string[];
  customFields: ProfileCustomField[];
  imageSlots: ProfileImageSlot[];
  slotAspect: Record<string, number>;
  /** Loại chứng chỉ đính kèm, theo thứ tự in. */
  attachments: string[];
}

export interface ExcelReportTemplate {
  /** Có cấu hình này thì là "Mẫu hồ sơ" (điền bằng ô {{trường}}); không có là mẫu gán tọa độ ô kiểu cũ. */
  profile?: ProfileTemplateConfig;
  id: string;
  name: string;
  description?: string;
  fileName: string;
  fileBase64: string;
  sheetName?: string;
  mappings: ExcelCellMapping[];
  createdAt: string;
  updatedAt: string;
}

export function isValidCellAddress(cell: string): boolean {
  return /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i.test(cell.trim());
}

export function normalizeCellAddress(cell: string): string {
  return cell.trim().toUpperCase();
}

export function formatVnDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return dateStr;
}

export function mapEmployeeToExcelData(employee: Employee): Record<ExcelFieldKey, string> {
  return {
    name: employee.name ?? "",
    code: employee.code ?? "",
    dob: formatVnDate(employee.dob),
    gender: employee.gender ?? "Nam",
    cccd: employee.cccd ?? "",
    phone: employee.phone ?? "",
    home: employee.home ?? "",
    address: employee.address ?? "",
    currentAddress: employee.currentAddress ?? employee.address ?? "",
    position: employee.position ?? "",
    group: employee.group ? `Nhóm ${employee.group}` : "",
    startDate: formatVnDate(employee.startDate),
    status: employee.status === "active" ? "Đang làm việc" : "Đã nghỉ việc",
  };
}
