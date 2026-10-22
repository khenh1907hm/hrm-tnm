import type { ProfileCustomField, ProfileTemplateConfig } from "../types";
import { normalizeText } from "../../../lib/text";
import { formatCustomValue, SYSTEM_FIELDS } from "./fieldValues";
import type { TemplateScan } from "./scanTemplate";

export const IMAGE_FIELDS = [
  { key: "photo3x4", label: "Ảnh 3×4 của nhân sự" },
  { key: "cccdImage", label: "Ảnh CCCD" },
  { key: "signature", label: "Ảnh chữ ký người ký" },
] as const;

/** Mẫu có dùng người ký (ô {{signer…}} hoặc vùng ảnh IMG_signature) → khi xuất cần chọn người ký. */
export function usesSigner(config: Pick<ProfileTemplateConfig, "placeholders" | "imageSlots">): boolean {
  return config.placeholders.some((key) => key.startsWith("signer")) || config.imageSlots.some((slot) => slot.field === "signature");
}

const CERT_PREFIX = "cert:";
const systemKeys = new Set(SYSTEM_FIELDS.map((field) => field.key));

export const isCertificateKey = (key: string) => key.startsWith(CERT_PREFIX);
export const certificateTypeOf = (key: string) => key.slice(CERT_PREFIX.length);

/** Khóa không phải trường hệ thống hay ô chứng chỉ là trường tùy chỉnh (nhập giá trị). */
export const isCustomKey = (key: string) => !systemKeys.has(key) && !isCertificateKey(key);

const guessKind = (key: string): ProfileCustomField["kind"] => (/date|ngay/i.test(key) ? "date" : "text");

/** Dựng cấu hình mẫu hồ sơ từ kết quả đọc file; giữ lại nhãn, kiểu, giá trị đã cài ở lần trước. */
export function profileConfigFromScan(scan: TemplateScan, previous?: ProfileTemplateConfig): ProfileTemplateConfig {
  const fromPlaceholders = scan.placeholders.filter(isCustomKey).map((key) => previous?.customFields.find((field) => field.key === key) ?? { key, label: key, kind: guessKind(key), defaultValue: "" });
  // Trường người dùng tự thêm (có ô đích) không nằm trong file → giữ nguyên khi tải lại file mẫu
  const customFields = [...fromPlaceholders, ...(previous?.customFields.filter((field) => field.target && !scan.placeholders.includes(field.key)) ?? [])];
  // Vùng ảnh: lấy theo vùng tên IMG_ trong file, trừ vùng người dùng đã sửa trong app (giữ nguyên, kể cả vùng không có trong file)
  const edited = previous?.imageSlots.filter((slot) => slot.custom) ?? [];
  const imageSlots = [
    ...scan.imageSlots.filter((slot) => !edited.some((item) => item.field === slot.field)).map((slot) => ({ ...slot, fit: previous?.imageSlots.find((item) => item.field === slot.field)?.fit ?? (slot.field === "photo3x4" ? "cover" as const : "contain" as const) })),
    ...edited,
  ];
  const certificateKeys = scan.placeholders.filter(isCertificateKey).map(certificateTypeOf);
  return {
    sheetName: scan.sheetName,
    printArea: previous?.printArea ?? scan.printArea ?? "A1:Z60",
    placeholders: scan.placeholders,
    customFields,
    imageSlots,
    slotAspect: scan.slotAspect,
    attachments: previous?.attachments ?? certificateKeys,
    ...(previous?.signatureId ? { signatureId: previous.signatureId } : {}),
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

/**
 * Giá trị trường tùy chỉnh (không gồm ảnh) đã định dạng.
 * - phạm vi "employee": lấy từ hồ sơ nhân sự (`employeeValues`);
 * - còn lại: giá trị người xuất sửa (`overrides`) hoặc giá trị mặc định của mẫu.
 */
export function customValues(config: Pick<ProfileTemplateConfig, "customFields">, overrides: Readonly<Record<string, string>> = {}, employeeValues: Readonly<Record<string, string>> = {}): Record<string, string> {
  return Object.fromEntries(config.customFields.filter((field) => field.kind !== "image").map((field) => {
    const raw = field.scope === "employee" ? employeeValues[field.key] ?? "" : overrides[field.key] ?? field.defaultValue;
    return [field.key, formatCustomValue(field.kind as Exclude<typeof field.kind, "image">, field.kind === "checkbox" ? raw === "true" : raw)];
  }));
}

/** Ô đích → giá trị, cho các trường tự thêm có chỉ định ô (không cần {{mã}} trong Excel). */
export function targetCellValues(config: Pick<ProfileTemplateConfig, "customFields">, values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(config.customFields.filter((field) => field.kind !== "image" && field.target).map((field) => [field.target!.toUpperCase(), values[field.key] ?? ""]));
}

/** Vùng ảnh của các trường tùy chỉnh kiểu ảnh. */
export function customImageSlots(config: Pick<ProfileTemplateConfig, "customFields">): { field: string; range: string }[] {
  return config.customFields.filter((field) => field.kind === "image" && field.target).map((field) => ({ field: field.key, range: field.target!.toUpperCase() }));
}

/** Tạo mã trường từ tên hiển thị: "Logo nhà thầu" → "logoNhaThau"; tránh trùng mã đã có. */
export function fieldKeyFromLabel(label: string, taken: readonly string[]): string {
  const words = normalizeText(label).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  while (words[0] && /^[0-9]/.test(words[0])) words.shift(); // mã phải bắt đầu bằng chữ cái
  const base = words.map((word, index) => index ? word[0]!.toUpperCase() + word.slice(1) : word).join("").slice(0, 32) || "truong";
  let key = base;
  for (let index = 2; taken.includes(key); index += 1) key = `${base}${index}`;
  return key;
}
