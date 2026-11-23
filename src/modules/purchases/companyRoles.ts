/**
 * Chức danh của công ty (lưu ở procurement_settings.departments). Ai không có chức danh là nhân viên thường.
 * Kho kiêm Vật tư: khối "material" ở máy chủ lấy người của Kho khi chưa đặt riêng.
 */
export type CompanyRole = "leader" | "technical" | "accounting" | "intake" | "sales" | "warehouse" | "hr";
/** max: số người tối đa của chức danh (Sếp chỉ 1 người). */
export const COMPANY_ROLES: readonly { key: CompanyRole; label: string; hint: string; max?: number }[] = [
  { key: "leader", label: "Sếp (Giám đốc)", hint: "Chỉ 1 người. Duyệt cuối cùng mọi phiếu; mặc định có trong mọi dự án", max: 1 },
  { key: "technical", label: "Kỹ sư", hint: "Kỹ sư phụ trách, ký phần kỹ thuật" },
  { key: "accounting", label: "Kế toán", hint: "Chi tiền khoản đã duyệt; mặc định có trong mọi dự án" },
  { key: "intake", label: "Kiểm soát đầu vào", hint: "Thuộc kế toán: kiểm soát chất lượng đầu vào (đơn nháp, RFP, hàng về); mặc định có trong mọi dự án" },
  { key: "sales", label: "Kinh doanh", hint: "Khách hàng, báo giá, Confirm Contract" },
  { key: "warehouse", label: "Kho (kiêm Vật tư)", hint: "Nhận hàng, kiểm đếm, nhập kho (PO, theo dõi đơn do người lập nắm)" },
  { key: "hr", label: "Nhân sự", hint: "Các vấn đề nhân sự: hồ sơ, chứng chỉ, nhắc hạn. Người giữ chức danh tự có quyền Nhân sự (cần tài khoản đã liên kết hồ sơ)" },
];
export const COMPANY_ROLE_LABELS = Object.fromEntries(COMPANY_ROLES.map((role) => [role.key, role.label])) as Record<CompanyRole, string>;
/** Mọi dự án luôn có các chức danh này (không cần thêm vào dự án). */
export const DEFAULT_PROJECT_ROLES: readonly CompanyRole[] = ["leader", "accounting", "intake"];

/** Người trong một khối duyệt: mã hồ sơ, hoặc "role:<chức danh>" (người đang giữ chức danh lúc gửi phiếu). */
export const roleToken = (role: CompanyRole) => `role:${role}`;
export const tokenRole = (token: string): CompanyRole | null => {
  const key = token.startsWith("role:") ? token.slice(5) : "";
  return COMPANY_ROLES.some((role) => role.key === key) ? key as CompanyRole : null;
};
