import type { Employee } from "../employees/types";
import type { Certificate } from "./types";

export const SAFETY_CERTIFICATE_TYPE = "atld";

/** 6 nhóm huấn luyện an toàn, vệ sinh lao động theo Nghị định 44/2016/NĐ-CP. */
export const SAFETY_GROUPS = [
  { group: 1, label: "Nhóm 1", description: "Người quản lý phụ trách công tác an toàn, vệ sinh lao động" },
  { group: 2, label: "Nhóm 2", description: "Người làm công tác an toàn, vệ sinh lao động" },
  { group: 3, label: "Nhóm 3", description: "Người lao động làm công việc có yêu cầu nghiêm ngặt về an toàn, vệ sinh lao động" },
  { group: 4, label: "Nhóm 4", description: "Người lao động không thuộc các nhóm 1, 2, 3, 5, 6" },
  { group: 5, label: "Nhóm 5", description: "Người làm công tác y tế" },
  { group: 6, label: "Nhóm 6", description: "An toàn, vệ sinh viên" },
] as const;

export const isSafetyCertificateType = (type: string) => type === SAFETY_CERTIFICATE_TYPE;
export const isValidSafetyGroup = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;

/** Nhóm chỉ có nghĩa với chứng chỉ An toàn lao động; loại khác luôn lưu null. */
export function normalizeSafetyGroup(type: string, value: number | null | undefined): number | null {
  return isSafetyCertificateType(type) && isValidSafetyGroup(value) ? value : null;
}

/**
 * Nhóm an toàn hiện tại của nhân sự: lấy từ chứng chỉ ATLĐ hiện hành còn hạn xa nhất có ghi nhóm,
 * nếu chưa có thì dùng nhóm ghi trên hồ sơ nhân sự (dữ liệu cũ).
 */
export function currentSafetyGroup(employee: Pick<Employee, "id" | "group">, certificates: readonly Certificate[]): number | null {
  const fromCertificate = certificates
    .filter((item) => item.employeeId === employee.id && item.state === "current" && isSafetyCertificateType(item.type) && isValidSafetyGroup(item.safetyGroup))
    .sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))[0]?.safetyGroup;
  return fromCertificate ?? employee.group;
}

export const safetyGroupTitle = (group: number) => `Nhóm ${group}`;

/**
 * Một người có thể có nhiều nhóm ATLĐ cùng lúc (vd Nhóm 1 và Nhóm 3) → mỗi nhóm là một chứng chỉ riêng.
 * Không nhập tên phân biệt thì tên mặc định là "Nhóm N" để phân biệt các chứng chỉ ATLĐ với nhau.
 */
export function certificateTitleFor(type: string, title: string | undefined, group: number | null | undefined): string {
  const trimmed = (title ?? "").trim();
  return !trimmed && isSafetyCertificateType(type) && isValidSafetyGroup(group) ? safetyGroupTitle(group) : title ?? "";
}

/** Các nhóm ATLĐ còn hiệu lực tại một ngày (mặc định: mọi chứng chỉ hiện hành), tăng dần; không có thì dùng nhóm trên hồ sơ. */
export function currentSafetyGroups(employee: Pick<Employee, "id" | "group">, certificates: readonly Certificate[], onDate?: string): number[] {
  const groups = certificates
    .filter((item) => item.employeeId === employee.id && item.state === "current" && isSafetyCertificateType(item.type) && isValidSafetyGroup(item.safetyGroup) && (!onDate || item.expiryDate >= onDate))
    .map((item) => item.safetyGroup as number);
  const unique = [...new Set(groups)].sort((a, b) => a - b);
  return unique.length ? unique : employee.group === null ? [] : [employee.group];
}

/** "Nhóm 1, 3" hoặc chuỗi rỗng. */
export const formatSafetyGroups = (groups: readonly number[]) => (groups.length ? `Nhóm ${groups.join(", ")}` : "");

