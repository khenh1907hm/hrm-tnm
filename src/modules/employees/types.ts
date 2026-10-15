import type { Gender } from "../../lib/vietnam/cccd";
import type { FileRef } from "../certificates/types";
export const POSITIONS = ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
export type Position = (typeof POSITIONS)[number];
export type EmploymentStatus = "active" | "on_leave" | "resigned";
export type EmployeeInput = {
  code: string; name: string; dob: string; gender: Gender; cccd: string; phone: string;
  home: string; address: string; currentAddress?: string; position: Position; group: number | null; startDate: string;
  emergencyContactId: string | null; status: EmploymentStatus; endDate: string | null;
  mismatchOverrideReason?: string; photo?: string | null;
};
export type Employee = EmployeeInput & {
  id: string; version: number; archivedAt: string | null; archivedBy: string | null;
  archiveReason: string | null; cccdMismatchOverrideReason: string | null;
  /** Giá trị trường tùy chỉnh của mẫu hồ sơ (phạm vi "theo nhân sự"): chữ, ngày ISO, "true"/"" cho ô đánh dấu. */
  extraFields?: Record<string, string>;
  /** Ảnh của trường tùy chỉnh kiểu ảnh, theo khóa trường. */
  extraFiles?: Record<string, FileRef>;
};
