/**
 * Ô "Giao tới" của đơn hàng: chọn Văn phòng (địa chỉ công ty), Dự án (địa chỉ công trình) hoặc Khác (gõ tay).
 * Vẫn lưu thành một chuỗi trong delivery_address; loại được đọc lại theo tiền tố.
 */
export type DeliveryKind = "office" | "project" | "other";
export const DELIVERY_LABELS: Record<DeliveryKind, string> = { office: "Văn phòng", project: "Dự án", other: "Khác" };
export const OFFICE_ADDRESS = "75 Nguyễn Cửu Đàm, P. Tân Sơn Nhì, Tp. Hồ Chí Minh";

const OFFICE_PREFIX = "Văn phòng";
const PROJECT_PREFIX = "Dự án";

export function deliveryKindOf(address: string, fallback: DeliveryKind = "office"): DeliveryKind {
  const text = address.trim();
  if (!text) return fallback;
  if (text.startsWith(OFFICE_PREFIX)) return "office";
  if (text.startsWith(PROJECT_PREFIX)) return "project";
  return "other";
}

/** Địa chỉ giao theo loại; "Khác" giữ nguyên chữ người dùng gõ (bỏ tiền tố của hai loại kia nếu còn). */
export function deliveryAddressFor(kind: DeliveryKind, project: { code: string; site?: string } | null, typed = ""): string {
  if (kind === "office") return `${OFFICE_PREFIX}: ${OFFICE_ADDRESS}`;
  if (kind === "project") return project ? `${PROJECT_PREFIX} ${project.code}${project.site?.trim() ? `: ${project.site.trim()}` : ""}` : PROJECT_PREFIX;
  return deliveryKindOf(typed) === "other" ? typed : "";
}
