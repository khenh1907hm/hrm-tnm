import type { Gender } from "../../lib/vietnam/cccd";
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
};
