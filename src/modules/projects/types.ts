export type ProjectStatus = "planning" | "active" | "closed";
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { planning: "Chuẩn bị", active: "Đang thi công", closed: "Đã kết thúc" };

export type ProjectInput = {
  name: string;
  /** Khách hàng / chủ đầu tư, vd: Taikisha. */
  customer: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  /** Mẫu hồ sơ (FORM báo cáo) dùng khi xuất cho dự án này. */
  templateId: string | null;
  /** Nhân sự tham gia (id), giữ thứ tự chọn. */
  memberIds: string[];
  /** Chỉ huy trưởng công trường: một người trong danh sách tham gia, là người liên hệ khẩn cấp của cả đoàn. */
  commanderId: string | null;
  commanderRelation: string;
  /** Giá trị các trường "nhập khi xuất" của mẫu, lưu theo dự án để khỏi nhập lại. */
  exportValues: Record<string, string>;
  note: string;
};

export type Project = ProjectInput & { id: string; version: number; createdAt: string; updatedAt: string; archivedAt: string | null };
