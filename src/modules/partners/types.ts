import { normalizeText } from "../../lib/text";

/** Đối tác (khách hàng / chủ đầu tư): tên và ảnh (logo, ảnh dự án) dùng khi điền mẫu hồ sơ. */
export type Partner = { id: string; name: string; image: string };

export const PARTNER_NAME_MAX = 200;
/** Ảnh lưu dạng data URL, giới hạn như ảnh cố định của mẫu hồ sơ. */
export const PARTNER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,/;

/** Số byte thật của ảnh trong data URL base64. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

/** Kiểm tra trước khi lưu; trả về thông báo lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validatePartner(input: { id?: string; name: string; image: string }, existing: readonly Partner[]): string | null {
  const name = input.name.trim();
  if (!name) return "Nhập tên đối tác.";
  if (name.length > PARTNER_NAME_MAX) return `Tên đối tác tối đa ${PARTNER_NAME_MAX} ký tự.`;
  if (existing.some((partner) => partner.id !== input.id && normalizeText(partner.name) === normalizeText(name))) return "Đã có đối tác cùng tên.";
  if (input.image && !IMAGE_DATA_URL.test(input.image)) return "Ảnh phải là PNG hoặc JPG.";
  if (input.image && dataUrlBytes(input.image) > PARTNER_IMAGE_MAX_BYTES) return "Ảnh tối đa 2 MB.";
  return null;
}

/** Sắp theo tên tiếng Việt (không phân biệt dấu, hoa thường). */
export function sortPartners(partners: readonly Partner[]): Partner[] {
  return [...partners].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1));
}
