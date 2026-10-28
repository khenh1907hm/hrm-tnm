import { normalizeText } from "../../lib/text";

/** Biến dùng được trong quy tắc đặt tên tệp xuất (viết hoa/thường, có dấu hay không đều được). */
export const FILE_NAME_TOKENS = [
  { token: "{mã nhân viên}", label: "Mã nhân viên" },
  { token: "{tên nhân viên}", label: "Tên nhân viên" },
  { token: "{chức vụ}", label: "Chức vụ" },
  { token: "{ngày xuất}", label: "Ngày xuất" },
] as const;

/** Biến thêm cho tên tệp từng chứng chỉ khi xuất riêng chứng chỉ. */
export const CERTIFICATE_FILE_TOKENS = [
  { token: "{stt}", label: "Số thứ tự" },
  { token: "{loại chứng chỉ}", label: "Loại chứng chỉ (theo tên gọi khi xuất)" },
  { token: "{tên chứng chỉ}", label: "Tên/ghi chú chứng chỉ" },
  { token: "{ngày hết hạn}", label: "Ngày hết hạn" },
] as const;

/** Biến cho tên thư mục tổng chứa hồ sơ chứng chỉ của mọi nhân sự. */
export const CERTIFICATE_FOLDER_TOKENS = [
  { token: "{tên mẫu}", label: "Tên mẫu" },
  { token: "{số người}", label: "Số nhân sự" },
  { token: "{ngày xuất}", label: "Ngày xuất" },
] as const;

type Person = { code: string; name: string; position?: string };

const ALIASES: Record<string, (person: Person, exportDate: string) => string> = {
  "ma nhan vien": (person) => person.code, "ma nv": (person) => person.code, "ma": (person) => person.code,
  "ten nhan vien": (person) => person.name, "ho ten": (person) => person.name, "ho va ten": (person) => person.name, "ten": (person) => person.name,
  "chuc vu": (person) => person.position ?? "", "chuc danh": (person) => person.position ?? "",
  "ngay xuat": (_, exportDate) => exportDate.split("-").reverse().join("-"),
};

/**
 * Áp quy tắc đặt tên (vd "Vinci - {mã nhân viên} - {tên nhân viên}") cho một nhân sự, chưa gồm đuôi tệp.
 * Ký tự Windows không cho phép trong tên tệp (\ / : * ? " < > |) đổi thành "-"; biến không nhận ra được giữ nguyên và báo lại.
 */
export function applyFileNamePattern(pattern: string, person: Person | null, exportDate: string, extra: Readonly<Record<string, string>> = {}): { name: string; unknownTokens: string[] } {
  const unknownTokens: string[] = [];
  const filled = pattern.replace(/\{([^{}]*)\}/g, (whole, inner: string) => {
    const key = normalizeText(inner).replace(/\s+/g, " ").trim();
    // Biến thêm (khóa không dấu, vd "stt", "loai chung chi") ưu tiên hơn biến nhân sự
    if (key in extra) return extra[key]!;
    const resolve = ALIASES[key];
    if (resolve && (person || key === "ngay xuat")) return resolve(person ?? { code: "", name: "" }, exportDate);
    unknownTokens.push(whole);
    return whole;
  });
  const name = filled.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 150);
  return { name, unknownTokens };
}
