/**
 * Chức danh của công ty (lưu ở procurement_settings.departments). Ai không có chức danh là Kỹ sư.
 * Kho kiêm Vật tư: khối "material" ở máy chủ lấy người của Kho khi chưa đặt riêng.
 */
export type CompanyRole = "leader" | "technical" | "accounting" | "intake" | "sales" | "warehouse";
export const COMPANY_ROLES: readonly { key: CompanyRole; label: string; hint: string }[] = [
  { key: "leader", label: "Giám đốc", hint: "Duyệt cuối cùng mọi phiếu; mặc định có trong mọi dự án" },
  { key: "technical", label: "Trưởng kỹ sư", hint: "Trưởng nhóm kỹ sư, ký phần kỹ thuật" },
  { key: "accounting", label: "Kế toán", hint: "Chi tiền khoản đã duyệt; mặc định có trong mọi dự án" },
  { key: "intake", label: "Người duyệt đầu vào", hint: "Thuộc kế toán: kiểm soát chất lượng đầu vào (đơn nháp, RFP, hàng về); mặc định có trong mọi dự án" },
  { key: "sales", label: "Kinh doanh", hint: "Khách hàng, báo giá, Confirm Contract" },
  { key: "warehouse", label: "Kho (kiêm Vật tư)", hint: "Phát hành PO, theo dõi đơn, nhận hàng, nhập kho" },
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
