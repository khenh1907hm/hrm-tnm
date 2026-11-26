import { hasAccess, type AccessKey, type Actor } from "../../modules/auth/permissions";
import type { PageView } from "./shared";

/** Đường dẫn riêng của từng màn hình (không dấu, dễ gõ và chia sẻ). */
export const VIEW_PATHS: Record<PageView, string> = {
  employees: "/nhan-su",
  alerts: "/canh-bao",
  signatures: "/chu-ky",
  reports: "/bao-cao",
  settings: "/cai-dat",
  skills: "/skills",
  tools: "/cong-cu",
  audit: "/nhat-ky",
  accounts: "/tai-khoan",
  certTypes: "/loai-chung-chi",
  projects: "/du-an",
  timesheet: "/cham-cong",
  laborRates: "/don-gia",
  purchases: "/dat-hang",
  projectPurchases: "/dat-hang-du-an",
  approvals: "/don-can-duyet",
  approvalSettings: "/quy-trinh-duyet",
  bugReports: "/bao-loi",
  monthlyReports: "/bao-cao-hang-thang",
};

/** Vai trò Nhân viên chỉ vào được các màn hình này. */
export const EMPLOYEE_VIEWS: readonly PageView[] = ["skills", "tools", "projects", "timesheet", "projectPurchases", "purchases", "approvals", "monthlyReports"];

/** Mục quyền cần có để mở từng màn hình; null là ai cũng mở được, "admin" là chỉ Admin. */
const VIEW_ACCESS: Record<PageView, AccessKey | "admin" | null> = {
  employees: "employees.view",
  alerts: "employees.view",
  signatures: "signatures.manage",
  reports: "reports.manage",
  settings: "reminders.manage",
  skills: null,
  tools: "tools",
  audit: "admin",
  accounts: "admin",
  certTypes: "certificateTypes.manage",
  // Ai cũng mở được: RLS chỉ trả dự án người đó được xem (theo quyền hoặc theo vai trò trong dự án)
  projects: null,
  timesheet: null,
  laborRates: "projects.rates",
  // Ai cũng lập được đơn hàng; RLS chỉ trả đơn người đó được xem
  purchases: null,
  projectPurchases: null,
  // Ai cũng mở được: chỉ thấy phiếu mình liên quan
  approvals: null,
  approvalSettings: "admin",
  bugReports: "admin",
  // Ai cũng mở được: RLS chỉ trả báo cáo người đó liên quan (người lập, người được giao, người trong dự án)
  monthlyReports: null,
};

export function canOpenView(actor: Actor, view: PageView): boolean {
  const needed = VIEW_ACCESS[view];
  if (needed === null) return true;
  return needed === "admin" ? actor.role === "admin" : hasAccess(actor, needed);
}

/** Trang mở đầu của người này: Việc của tôi (ai cũng mở được). */
export function firstOpenView(actor: Actor): PageView {
  return (["approvals", "employees", "signatures", "tools"] as const).find((view) => canOpenView(actor, view)) ?? "skills";
}

/** Tiêu đề tab trình duyệt theo màn hình. */
export const VIEW_TITLES: Record<PageView, string> = {
  employees: "Nhân sự",
  alerts: "Chứng chỉ sắp hết hạn",
  signatures: "Thư viện chữ ký",
  reports: "FORM Báo cáo",
  settings: "Cài đặt email",
  skills: "Kho Skill AI",
  tools: "Công cụ",
  audit: "Nhật ký thay đổi",
  accounts: "Tài khoản & phân quyền",
  certTypes: "Loại chứng chỉ",
  projects: "Dự án",
  timesheet: "Chấm công",
  laborRates: "Đơn giá & lịch làm việc",
  purchases: "Đặt hàng văn phòng",
  projectPurchases: "Đặt hàng dự án",
  approvals: "Việc của tôi",
  approvalSettings: "Quy trình duyệt",
  bugReports: "Báo lỗi",
  monthlyReports: "Báo cáo hằng tháng",
};

/** projectId chỉ có khi mở một dự án (/du-an/<id>). */
export type AppRoute = { view: PageView; employeeId: string | null; projectId?: string; purchaseId?: string };

/** Đọc màn hình từ URL. Trả về null nếu đường dẫn không thuộc app (để báo 404). */
export function parseRoute(pathname: string): AppRoute | null {
  let parts: string[];
  try { parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part)); }
  catch { return null; } // URL hỏng kiểu "/nhan-su/%E0"
  if (!parts.length) return { view: "approvals", employeeId: null };
  const view = (Object.keys(VIEW_PATHS) as PageView[]).find((key) => VIEW_PATHS[key] === `/${parts[0]}`);
  if (!view) return null;
  if (parts.length === 1) return { view, employeeId: null };
  if (view === "employees" && parts.length === 2) return { view, employeeId: parts[1]! };
  if (view === "projects" && parts.length === 2) return { view, employeeId: null, projectId: parts[1]! };
  if (view === "purchases" && parts.length === 2) return { view, employeeId: null, purchaseId: parts[1]! };
  return null;
}

/** URL của một dự án. */
export const projectPath = (projectId: string) => `${VIEW_PATHS.projects}/${encodeURIComponent(projectId)}`;

/** URL của một đơn hàng. */
/** Chi tiết đơn hàng của dự án mở ngay trong dự án (gắn id dự án), không sang trang Đặt hàng văn phòng. */
export const projectOrderPath = (projectId: string, orderId: string, slug = "dat-hang") => `${projectPath(projectId)}?muc=${slug}&don=${encodeURIComponent(orderId)}`;
export const orderIdFromUrl = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("don"));
export const purchasePath = (orderId: string) => `${VIEW_PATHS.purchases}/${encodeURIComponent(orderId)}`;

/** URL của một màn hình; có employeeId thì mở thẳng hồ sơ nhân sự đó. */
export function routePath(view: PageView, employeeId: string | null = null): string {
  return view === "employees" && employeeId ? `${VIEW_PATHS.employees}/${encodeURIComponent(employeeId)}` : VIEW_PATHS[view];
}

/**
 * Mở web trên điện thoại: chuyển sang giao diện app (tnm.com.vn/app, cùng phiên đăng nhập) cho đồng bộ.
 * Trang có màn tương ứng trong app thì mở đúng màn đó; còn lại về trang đầu của app.
 * Người dùng chọn "Bản đầy đủ" (?desktop=1) thì giữ web, nhớ trên máy.
 */
export const PREFER_DESKTOP_KEY = "tnm.preferDesktop";
export function mobileAppPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  if (pathname.startsWith(VIEW_PATHS.monthlyReports)) {
    const id = params.get("phieu");
    if (id) return `/app/inspection?id=${encodeURIComponent(id)}`;
    return params.get("muc") === "thiet-bi" ? "/app/tool-check" : "/app/monthly";
  }
  if (pathname.startsWith(VIEW_PATHS.timesheet)) return "/app/";
  return "/app/";
}
/** Chỉ chuyển ở điện thoại (màn hẹp, cảm ứng), không chuyển trang công khai / trang tạm. */
export function shouldUseMobileApp(input: { width: number; coarse: boolean; pathname: string; search: string; preferDesktop: boolean }): boolean {
  if (input.preferDesktop || new URLSearchParams(input.search).get("desktop") === "1") return false;
  if (/^\/(app|chinh-sach-bao-mat|nhap-ho-so-tam|skills)(\/|$)/.test(input.pathname)) return false;
  return input.coarse && input.width < 768;
}
