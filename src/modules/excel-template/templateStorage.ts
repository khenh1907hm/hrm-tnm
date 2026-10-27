import { createDefaultStarterTemplate } from "./populateTemplate";
import type { ExcelReportTemplate } from "./types";

export const STORAGE_KEY_TEMPLATES = "tnm_excel_report_templates";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    const val = bytes[i];
    if (val !== undefined) {
      binary += String.fromCharCode(val);
    }
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function createDefaultDemoTemplate(): Promise<ExcelReportTemplate> {
  const starterBytes = await createDefaultStarterTemplate();
  const base64 = uint8ArrayToBase64(starterBytes);

  return {
    id: "default-starter-template",
    name: "Phiếu thông tin nhân sự và an toàn lao động",
    description: "Mẫu báo cáo chuẩn của hệ thống, định dạng 2 cột thông tin cá nhân và thông tin công việc.",
    fileName: "phieu-thong-tin-nhan-su.xlsx",
    fileBase64: base64,
    sheetName: "Phiếu nhân viên",
    mappings: [
      { cell: "C5", field: "code" },
      { cell: "E5", field: "position" },
      { cell: "C6", field: "name" },
      { cell: "E6", field: "gender" },
      { cell: "C7", field: "dob" },
      { cell: "E7", field: "phone" },
      { cell: "C8", field: "cccd" },
      { cell: "E8", field: "group" },
      { cell: "C9", field: "home" },
      { cell: "E9", field: "startDate" },
      { cell: "C10", field: "address" },
      { cell: "E10", field: "status" },
      { cell: "C11", field: "currentAddress" },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function loadTemplates(): ExcelReportTemplate[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: ExcelReportTemplate[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(templates));
  } catch {
    // ignore quota errors
  }
}

/**
 * Nhân bản một mẫu báo cáo: giữ nguyên file Excel và toàn bộ cấu hình (ô, vùng ảnh, chứng chỉ đính kèm…),
 * đổi id, đặt tên "… (bản sao)" không trùng mẫu khác và mốc thời gian mới.
 */
export function duplicateTemplate(template: ExcelReportTemplate, existing: readonly ExcelReportTemplate[], id: string, now: string): ExcelReportTemplate {
  const names = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  const base = `${template.name.trim()} (bản sao)`;
  let name = base;
  for (let index = 2; names.has(name.toLowerCase()); index++) name = `${template.name.trim()} (bản sao ${index})`;
  return { ...structuredClone(template), id, name, createdAt: now, updatedAt: now };
}
