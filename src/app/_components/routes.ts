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
};

/** Vai trò Nhân viên chỉ vào được các màn hình này. */
export const EMPLOYEE_VIEWS: readonly PageView[] = ["skills", "tools"];

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
};

export function canOpenView(actor: Actor, view: PageView): boolean {
  const needed = VIEW_ACCESS[view];
  if (needed === null) return true;
  return needed === "admin" ? actor.role === "admin" : hasAccess(actor, needed);
}

/** Trang mở đầu của người này: màn hình đầu tiên họ được vào (Kho Skill AI luôn mở được). */
export function firstOpenView(actor: Actor): PageView {
  return (["employees", "signatures", "tools"] as const).find((view) => canOpenView(actor, view)) ?? "skills";
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
};

export type AppRoute = { view: PageView; employeeId: string | null };

/** Đọc màn hình từ URL. Trả về null nếu đường dẫn không thuộc app (để báo 404). */
export function parseRoute(pathname: string): AppRoute | null {
  let parts: string[];
  try { parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part)); }
  catch { return null; } // URL hỏng kiểu "/nhan-su/%E0"
  if (!parts.length) return { view: "employees", employeeId: null };
  const view = (Object.keys(VIEW_PATHS) as PageView[]).find((key) => VIEW_PATHS[key] === `/${parts[0]}`);
  if (!view) return null;
  if (parts.length === 1) return { view, employeeId: null };
  if (view === "employees" && parts.length === 2) return { view, employeeId: parts[1]! };
  return null;
}

/** URL của một màn hình; có employeeId thì mở thẳng hồ sơ nhân sự đó. */
export function routePath(view: PageView, employeeId: string | null = null): string {
  return view === "employees" && employeeId ? `${VIEW_PATHS.employees}/${encodeURIComponent(employeeId)}` : VIEW_PATHS[view];
}
