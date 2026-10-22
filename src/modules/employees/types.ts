import type { Gender } from "../../lib/vietnam/cccd";
import type { FileRef } from "../certificates/types";
export const POSITIONS = ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
export type Position = (typeof POSITIONS)[number];
export type EmploymentStatus = "active" | "on_leave" | "resigned";
export type EmployeeInput = {
  code: string; name: string; dob: string; gender: Gender; cccd: string; phone: string;
  home: string; address: string; currentAddress?: string; position: Position; group: number | null;
  /** Ngày bắt đầu làm nghề — dùng để tính kinh nghiệm. */
  startDate: string;
  /** Ngày bắt đầu làm việc tại TNM. */
  companyStartDate?: string | null;
  emergencyContactId: string | null; status: EmploymentStatus; endDate: string | null;
  mismatchOverrideReason?: string; photo?: string | null;
  /** Ảnh chữ ký của chính nhân sự (PNG nền trong suốt, dạng data URL), có thể để trống. */
  signatureImage?: string | null;
  mismatchOverrideReason?: string;
  /** Ảnh chân dung 3×4 trong kho lưu trữ (thư mục employees). */
  photo?: FileRef | null;
};
export type Employee = Omit<EmployeeInput, "photo"> & {
  /** Như EmployeeInput; chuỗi data URL là dữ liệu cũ chưa chuyển sang kho, chỉ còn đọc. */
  photo?: FileRef | string | null;
  id: string; version: number; archivedAt: string | null; archivedBy: string | null;
  archiveReason: string | null; cccdMismatchOverrideReason: string | null;
  /** Giá trị trường tùy chỉnh của mẫu hồ sơ (phạm vi "theo nhân sự"): chữ, ngày ISO, "true"/"" cho ô đánh dấu. */
  extraFields?: Record<string, string>;
  /** Ảnh của trường tùy chỉnh kiểu ảnh, theo khóa trường. */
  extraFiles?: Record<string, FileRef>;
};
