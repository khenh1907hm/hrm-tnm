import type { Role } from "../../modules/auth/permissions";
import type { PageView } from "./shared";

/** Vai trò chỉ dùng khung giới hạn (Công cụ, Kho Skill AI), không dựng app nhân sự. */
export type LimitedRole = "engineer" | "employee";
/** Vai trò đọc từ bảng profiles; giá trị lạ hoặc thiếu → "pending" (chờ cấp quyền). */
export type ProfileRole = Role | LimitedRole | "pending";

const KNOWN: readonly ProfileRole[] = ["admin", "hr", "engineer", "employee", "pending"];

export function parseProfileRole(raw: unknown): ProfileRole {
  return KNOWN.includes(raw as ProfileRole) ? raw as ProfileRole : "pending";
}

export function isLimitedRole(role: ProfileRole): role is LimitedRole {
  return role === "engineer" || role === "employee";
}

/** Nhãn, trang mở đầu và thứ tự menu của khung giới hạn theo vai trò. */
export const LIMITED_ROLE_INFO: Record<LimitedRole, { label: string; home: PageView; nav: readonly PageView[] }> = {
  engineer: { label: "Kỹ sư", home: "tools", nav: ["tools", "skills"] },
  employee: { label: "Nhân viên", home: "skills", nav: ["skills", "tools"] },
};
