import { expirySortKey, isValidOn } from "../certificates/status";
import type { Certificate } from "../certificates/types";
import type { CertificateExportConfig } from "./types";

/**
 * Cấu hình tải thư mục chứng chỉ không cần mẫu Excel: lấy loại nào, theo thứ tự nào, đặt tên thư mục/tệp ra sao.
 * Kết quả: <thư mục tổng>/<thư mục từng nhân sự>/1. …, 2. …
 */
export interface CertificateFolderPreset {
  id: string;
  name: string;
  /** Loại chứng chỉ cần lấy, đúng thứ tự đánh số; trống = mọi loại (theo thứ tự loại chứng chỉ). */
  typeKeys: string[];
  /** Chỉ lấy chứng chỉ còn hiệu lực vào ngày xuất. */
  validOnly: boolean;
  /** Tên thư mục từng nhân sự, vd "Vinci - {mã nhân viên} - {tên nhân viên}"; trống = "{mã nhân viên} - {tên nhân viên}". */
  employeeFolderPattern: string;
  naming: CertificateExportConfig;
}

export const DEFAULT_CERTIFICATE_FOLDER_PRESET: CertificateFolderPreset = { id: "default", name: "Mặc định", typeKeys: [], validOnly: true, employeeFolderPattern: "", naming: {} };

/** Chứng chỉ hiện hành của một nhân sự cần đưa vào thư mục, đã sắp: theo thứ tự loại trong cấu hình, cùng loại thì hạn gần trước. */
export function pickCertificatesForFolder(certificates: readonly Certificate[], preset: Pick<CertificateFolderPreset, "typeKeys" | "validOnly">, exportDate: string, allTypeKeys: readonly string[] = []): Certificate[] {
  const order = preset.typeKeys.length ? preset.typeKeys : allTypeKeys;
  const rank = (type: string) => { const index = order.indexOf(type); return index < 0 ? order.length : index; };
  return certificates
    .filter((item) => item.state === "current" && (!preset.typeKeys.length || preset.typeKeys.includes(item.type)) && (!preset.validOnly || isValidOn(item.expiryDate, exportDate)))
    .sort((a, b) => rank(a.type) - rank(b.type) || expirySortKey(a.expiryDate).localeCompare(expirySortKey(b.expiryDate)));
}

/** Đọc danh sách cấu hình đã lưu (bỏ bản ghi hỏng); luôn có ít nhất cấu hình mặc định. */
export function parseCertificateFolderPresets(raw: string | null): CertificateFolderPreset[] {
  try {
    const list = JSON.parse(raw ?? "[]") as unknown;
    const presets = (Array.isArray(list) ? list : []).flatMap((item): CertificateFolderPreset[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as Partial<CertificateFolderPreset>;
      if (typeof value.id !== "string" || typeof value.name !== "string") return [];
      return [{
        id: value.id,
        name: value.name,
        typeKeys: Array.isArray(value.typeKeys) ? value.typeKeys.filter((key): key is string => typeof key === "string") : [],
        validOnly: value.validOnly !== false,
        employeeFolderPattern: typeof value.employeeFolderPattern === "string" ? value.employeeFolderPattern : "",
        naming: value.naming && typeof value.naming === "object" ? value.naming : {},
      }];
    });
    return presets.length ? presets : [DEFAULT_CERTIFICATE_FOLDER_PRESET];
  } catch {
    return [DEFAULT_CERTIFICATE_FOLDER_PRESET];
  }
}
