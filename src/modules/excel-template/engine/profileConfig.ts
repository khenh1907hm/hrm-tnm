import type { ProfileCustomField, ProfileTemplateConfig } from "../types";
import { formatCustomValue, SYSTEM_FIELDS } from "./fieldValues";
import type { TemplateScan } from "./scanTemplate";

export const IMAGE_FIELDS = [
  { key: "photo3x4", label: "Ảnh 3×4 của nhân sự" },
  { key: "cccdImage", label: "Ảnh CCCD" },
] as const;

const CERT_PREFIX = "cert:";
const systemKeys = new Set(SYSTEM_FIELDS.map((field) => field.key));

export const isCertificateKey = (key: string) => key.startsWith(CERT_PREFIX);
export const certificateTypeOf = (key: string) => key.slice(CERT_PREFIX.length);

/** Khóa không phải trường hệ thống hay ô chứng chỉ là trường tùy chỉnh (nhập giá trị). */
export const isCustomKey = (key: string) => !systemKeys.has(key) && !isCertificateKey(key);

const guessKind = (key: string): ProfileCustomField["kind"] => (/date|ngay/i.test(key) ? "date" : "text");

/** Dựng cấu hình mẫu hồ sơ từ kết quả đọc file; giữ lại nhãn, kiểu, giá trị đã cài ở lần trước. */
export function profileConfigFromScan(scan: TemplateScan, previous?: ProfileTemplateConfig): ProfileTemplateConfig {
  const customFields = scan.placeholders.filter(isCustomKey).map((key) => previous?.customFields.find((field) => field.key === key) ?? { key, label: key, kind: guessKind(key), defaultValue: "" });
  const imageSlots = scan.imageSlots.map((slot) => ({ ...slot, fit: previous?.imageSlots.find((item) => item.field === slot.field)?.fit ?? (slot.field === "photo3x4" ? "cover" as const : "contain" as const) }));
  const fromPlaceholders = scan.placeholders.filter(isCertificateKey).map(certificateTypeOf);
  return {
    sheetName: scan.sheetName,
    printArea: previous?.printArea ?? scan.printArea ?? "A1:Z60",
    placeholders: scan.placeholders,
    customFields,
    imageSlots,
    slotAspect: scan.slotAspect,
    attachments: previous?.attachments ?? fromPlaceholders,
  };
}

/** Nhãn dễ đọc cho một khóa trường, dùng trong cảnh báo và giao diện. */
export function fieldLabel(key: string, config: Pick<ProfileTemplateConfig, "customFields">, typeNames: Readonly<Record<string, string>> = {}): string {
  if (isCertificateKey(key)) return `Ô chứng chỉ ${typeNames[certificateTypeOf(key)] ?? certificateTypeOf(key)}`;
  return SYSTEM_FIELDS.find((field) => field.key === key)?.label
    ?? IMAGE_FIELDS.find((field) => field.key === key)?.label
    ?? config.customFields.find((field) => field.key === key)?.label
    ?? key;
}

/** Giá trị trường tùy chỉnh đã định dạng; `overrides` là giá trị người xuất sửa (thô). */
export function customValues(config: Pick<ProfileTemplateConfig, "customFields">, overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return Object.fromEntries(config.customFields.map((field) => {
    const raw = overrides[field.key] ?? field.defaultValue;
    return [field.key, formatCustomValue(field.kind, field.kind === "checkbox" ? raw === "true" : raw)];
  }));
}
