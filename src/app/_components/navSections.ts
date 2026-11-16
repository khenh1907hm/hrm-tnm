import type { Actor } from "../../modules/auth/permissions";
import { canOpenView } from "./routes";
import type { PageView } from "./shared";

/**
 * Thanh bên gọn (phương án A): mỗi mục là một "phần", có thể gồm nhiều màn hình hiện thành tab ở đầu trang.
 * Người xem chỉ thấy phần có ít nhất một màn hình họ mở được; bấm phần là mở màn hình đầu tiên họ được vào.
 */
export type NavSectionKey = "inbox" | "people" | "certs" | "projects" | "timesheet" | "purchases" | "docs" | "settings";
export type NavSection = { key: NavSectionKey; label: string; group: string; views: readonly PageView[] };
export const NAV_SECTIONS: readonly NavSection[] = [
  { key: "inbox", label: "Việc của tôi", group: "", views: ["approvals"] },
  { key: "people", label: "Nhân sự", group: "Nhân sự", views: ["employees", "signatures"] },
  { key: "certs", label: "Chứng chỉ hết hạn", group: "Nhân sự", views: ["alerts"] },
  { key: "projects", label: "Dự án", group: "Dự án", views: ["projects"] },
  { key: "timesheet", label: "Chấm công", group: "Dự án", views: ["timesheet"] },
  { key: "purchases", label: "Đặt hàng", group: "Mua hàng", views: ["purchases"] },
  { key: "docs", label: "Tài liệu", group: "Khác", views: ["reports", "skills", "tools"] },
  { key: "settings", label: "Cài đặt", group: "Khác", views: ["accounts", "approvalSettings", "certTypes", "settings", "laborRates", "audit", "bugReports"] },
];
/** Tên tab của từng màn hình trong phần nhiều màn hình. */
export const TAB_LABELS: Partial<Record<PageView, string>> = {
  employees: "Danh sách nhân sự", signatures: "Thư viện chữ ký",
  reports: "FORM báo cáo (Excel)", skills: "Kho Skill AI", tools: "Công cụ",
  accounts: "Tài khoản & phân quyền", approvalSettings: "Quy trình duyệt", certTypes: "Loại chứng chỉ", settings: "Email nhắc hạn",
  laborRates: "Đơn giá & lịch làm việc", audit: "Nhật ký thay đổi", bugReports: "Báo lỗi",
};

export const sectionOf = (view: PageView) => NAV_SECTIONS.find((section) => section.views.includes(view)) ?? null;
/** Màn hình trong phần mà người này mở được (theo thứ tự). */
export const openViews = (actor: Actor, section: NavSection) => section.views.filter((view) => canOpenView(actor, view));
