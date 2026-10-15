import { formatDate, formatTenure, monthsBetween } from "../../../lib/dates";
import type { Certificate } from "../../certificates/types";
import type { Commander } from "../../commanders/types";
import type { Employee } from "../../employees/types";

export type SystemFieldKind = "text" | "date" | "checkbox";
export type SystemField = { key: string; label: string; kind: SystemFieldKind; group: "employee" | "computed" | "contact" | "certificate" };

const CHECKED = "☑";
const UNCHECKED = "☐";

/** Trường có sẵn trong hệ thống, dùng để gắn vào mẫu. Trường chứng chỉ có dạng `cert:<loại>`. */
export const SYSTEM_FIELDS: readonly SystemField[] = [
  { key: "code", label: "Mã nhân viên", kind: "text", group: "employee" },
  { key: "fullName", label: "Họ và tên", kind: "text", group: "employee" },
  { key: "fullNameUpper", label: "HỌ VÀ TÊN (in hoa)", kind: "text", group: "employee" },
  { key: "dob", label: "Ngày sinh", kind: "date", group: "employee" },
  { key: "gender", label: "Giới tính", kind: "text", group: "employee" },
  { key: "genderMale", label: "Ô Nam", kind: "checkbox", group: "employee" },
  { key: "genderFemale", label: "Ô Nữ", kind: "checkbox", group: "employee" },
  { key: "cccd", label: "Số CCCD", kind: "text", group: "employee" },
  { key: "phone", label: "Điện thoại", kind: "text", group: "employee" },
  { key: "home", label: "Quê quán", kind: "text", group: "employee" },
  { key: "address", label: "Thường trú", kind: "text", group: "employee" },
  { key: "currentAddress", label: "Địa chỉ hiện tại", kind: "text", group: "employee" },
  { key: "position", label: "Chức vụ", kind: "text", group: "employee" },
  { key: "startDate", label: "Ngày nhận việc", kind: "date", group: "employee" },
  { key: "safetyGroup", label: "Nhóm an toàn", kind: "text", group: "employee" },
  { key: "age", label: "Tuổi", kind: "text", group: "computed" },
  { key: "experience", label: "Thâm niên", kind: "text", group: "computed" },
  { key: "exportDate", label: "Ngày xuất", kind: "date", group: "computed" },
  { key: "contactName", label: "Người liên hệ khẩn cấp", kind: "text", group: "contact" },
  { key: "contactNameUpper", label: "NGƯỜI LIÊN HỆ (in hoa)", kind: "text", group: "contact" },
  { key: "contactRelation", label: "Quan hệ / chức vụ người liên hệ", kind: "text", group: "contact" },
  { key: "contactPhone", label: "Điện thoại người liên hệ", kind: "text", group: "contact" },
  { key: "contactAddress", label: "Địa chỉ người liên hệ", kind: "text", group: "contact" },
];

export function ageOn(dob: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) < dob.slice(5) ? years - 1 : years;
}

/** Chứng chỉ được tính là "có" khi đang hiện hành và còn hạn tại ngày xuất. */
export function hasValidCertificate(certificates: readonly Certificate[], type: string, exportDate: string): boolean {
  return certificates.some((certificate) => certificate.type === type && certificate.state === "current" && certificate.expiryDate >= exportDate);
}

export type FieldValueSource = {
  employee: Employee;
  commander: Commander | null;
  certificates: readonly Certificate[];
  certificateTypes: readonly string[];
  exportDate: string;
};

export function buildSystemValues(source: FieldValueSource): Record<string, string> {
  const { employee, commander, exportDate } = source;
  const months = monthsBetween(employee.startDate, exportDate);
  const values: Record<string, string> = {
    code: employee.code,
    fullName: employee.name,
    fullNameUpper: employee.name.toLocaleUpperCase("vi"),
    dob: formatDate(employee.dob),
    gender: employee.gender,
    genderMale: employee.gender === "Nam" ? CHECKED : UNCHECKED,
    genderFemale: employee.gender === "Nữ" ? CHECKED : UNCHECKED,
    cccd: employee.cccd,
    phone: employee.phone,
    home: employee.home,
    address: employee.address,
    currentAddress: employee.currentAddress ?? "",
    position: employee.position,
    startDate: formatDate(employee.startDate),
    safetyGroup: employee.group === null ? "" : `Nhóm ${employee.group}`,
    age: String(ageOn(employee.dob, exportDate)),
    experience: months === null ? "" : formatTenure(months),
    exportDate: formatDate(exportDate),
    contactName: commander?.name ?? "",
    contactNameUpper: commander?.name.toLocaleUpperCase("vi") ?? "",
    contactRelation: commander?.role ?? "",
    contactPhone: commander?.phone ?? "",
    contactAddress: commander?.address ?? "",
  };
  for (const type of source.certificateTypes) values[`cert:${type}`] = hasValidCertificate(source.certificates, type, exportDate) ? CHECKED : UNCHECKED;
  return values;
}

export type CustomFieldKind = "text" | "date" | "checkbox";

/** Đổi giá trị thô của trường tùy chỉnh sang chữ hiển thị trên mẫu. */
export function formatCustomValue(kind: CustomFieldKind, raw: string | boolean | null | undefined): string {
  if (kind === "checkbox") return raw === true ? CHECKED : UNCHECKED;
  if (typeof raw !== "string" || !raw) return "";
  return kind === "date" ? formatDate(raw) : raw;
}

/**
 * Gộp các lớp giá trị theo thứ tự ưu tiên tăng dần:
 * giá trị cố định của mẫu → biến dự án → giá trị sửa riêng cho một người.
 * Giá trị rỗng không đè lớp bên dưới.
 */
export function resolveLayers(...layers: readonly Readonly<Record<string, string>>[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const layer of layers) for (const [key, value] of Object.entries(layer)) if (value) result[key] = value;
  return result;
}
