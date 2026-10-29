import { applyFileNamePattern } from "./fileNamePattern";
import type { CertificateExportConfig, CertificateFolderGroup } from "./types";

export const DEFAULT_CERTIFICATE_FOLDER_PATTERN = "Chứng chỉ - {ngày xuất}";
export const DEFAULT_CERTIFICATE_FILE_PATTERN = "{stt}. {loại chứng chỉ}";
/** Thư mục từng nhân sự khi mẫu chưa có quy tắc đặt tên tệp. */
export const DEFAULT_EMPLOYEE_FOLDER_PATTERN = "{mã nhân viên} - {tên nhân viên}";

type Person = { code: string; name: string; position?: string };

const vnDate = (iso: string) => iso.split("-").reverse().join("-");

/** Tên gọi của loại chứng chỉ khi xuất: tên riêng đặt trong mẫu (vd "ID" thay cho "Căn cước công dân"), không có thì tên loại. */
export function certificateTypeLabel(config: CertificateExportConfig | undefined, typeKey: string, typeNames: Readonly<Record<string, string>>): string {
  return config?.typeLabels?.[typeKey]?.trim() || typeNames[typeKey] || typeKey;
}

/** Tên thư mục tổng (cũng là tên tệp ZIP, chưa có đuôi). */
export function certificateRootFolderName(config: CertificateExportConfig | undefined, context: { templateName: string; count: number; exportDate: string }): string {
  const extra = { "ten mau": context.templateName, "so nguoi": String(context.count) };
  return applyFileNamePattern(config?.folderPattern?.trim() || DEFAULT_CERTIFICATE_FOLDER_PATTERN, null, context.exportDate, extra).name
    || applyFileNamePattern(DEFAULT_CERTIFICATE_FOLDER_PATTERN, null, context.exportDate).name;
}

/** Thư mục từng nhân sự: theo quy tắc đặt tên tệp của mẫu (vd "Vinci - {mã nhân viên} - {tên nhân viên}"). */
export function employeeFolderName(fileNamePattern: string | undefined, person: Person, exportDate: string): string {
  return applyFileNamePattern(fileNamePattern?.trim() || DEFAULT_EMPLOYEE_FOLDER_PATTERN, person, exportDate).name
    || applyFileNamePattern(DEFAULT_EMPLOYEE_FOLDER_PATTERN, person, exportDate).name;
}

export type CertificateNameInput = { index: number; typeLabel: string; title: string; expiryDate: string | null };

/** Tên tệp một chứng chỉ (chưa có đuôi), vd "1. ID"; không kèm số chứng chỉ. */
export function certificateFileBaseName(config: CertificateExportConfig | undefined, certificate: CertificateNameInput, person: Person, exportDate: string): string {
  const extra = {
    stt: String(certificate.index),
    "loai chung chi": certificate.typeLabel,
    "ten chung chi": certificate.title,
    "ngay het han": certificate.expiryDate ? vnDate(certificate.expiryDate) : "Không thời hạn",
  };
  const name = applyFileNamePattern(config?.filePattern?.trim() || DEFAULT_CERTIFICATE_FILE_PATTERN, person, exportDate, extra).name;
  // Bỏ dấu nối thừa khi biến trống, vd "{loại chứng chỉ} - {tên chứng chỉ}" với chứng chỉ không có tên
  return name.replace(/(\s*-\s*)+$/, "").replace(/^(\s*-\s*)+/, "").replace(/\s*-(\s*-)+\s*/g, " - ").trim()
    || applyFileNamePattern(DEFAULT_CERTIFICATE_FILE_PATTERN, person, exportDate, extra).name;
}

/** Tên trùng trong cùng thư mục (không phân biệt hoa/thường như Windows) → thêm " (2)", " (3)"… trước đuôi tệp. */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let copy = 2; used.has(candidate.toLowerCase()); copy += 1) candidate = `${base} (${copy})${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Tên thư mục con của một nhóm, vd "4. Safety certificate". */
export function certificateGroupFolderName(index: number, group: Pick<CertificateFolderGroup, "name">, exportDate: string): string {
  return applyFileNamePattern("{stt}. {ten nhom}", null, exportDate, { stt: String(index), "ten nhom": group.name.trim() || "Nhóm" }).name;
}

export type CertificateFolderEntry<T> = { group: CertificateFolderGroup | null; items: T[] };

/**
 * Sắp các mục (đã đúng thứ tự) thành từng vị trí đánh số ở thư mục nhân sự: mục không thuộc nhóm đứng riêng,
 * mục thuộc nhóm gom lại tại vị trí mục đầu tiên của nhóm đó.
 */
export function groupCertificateEntries<T>(items: readonly T[], typeOf: (item: T) => string, groups: readonly CertificateFolderGroup[] | undefined): CertificateFolderEntry<T>[] {
  const groupOf = (type: string) => groups?.find((group) => group.typeKeys.includes(type)) ?? null;
  const entries: CertificateFolderEntry<T>[] = [];
  for (const item of items) {
    const group = groupOf(typeOf(item));
    const existing = group ? entries.find((entry) => entry.group?.id === group.id) : undefined;
    if (existing) existing.items.push(item); else entries.push({ group, items: [item] });
  }
  return entries;
}
