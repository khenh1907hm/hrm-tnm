import { issue, type Issue } from "../result";
import { restoreNameDiacritics } from "./restoreDiacritics";

export function normalizeName(value: string): string {
  const cleaned = value.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ");
  if (cleaned && cleaned === cleaned.toLocaleUpperCase("vi")) {
    return cleaned.toLocaleLowerCase("vi").replace(/(^|[\s.'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("vi"));
  }
  return cleaned;
}

export function validateName(input: string): { value: string; issues: Issue[] } {
  const value = normalizeName(input);
  const issues: Issue[] = [];
  if (value.length < 2 || value.length > 100) issues.push(issue("NAME_LENGTH", "name"));
  if (!/^[\p{L}\s'.-]+$/u.test(value) || value.trim().split(/\s+/).length < 2) issues.push(issue("NAME_INVALID", "name"));
  return { value, issues };
}

const TONE_MARKS = /[̣̀́̃̉]/;
/** Họ hoặc tên đệm hay bị OCR đọc mất dấu thanh; chỉ sửa khi không phải âm tiết cuối (tên gọi). */
const NON_FINAL_SYLLABLE_FIXES: Record<string, string> = { "NGUYÊN": "NGUYỄN" };

function keepFirstTone(syllable: string): string {
  let hasTone = false;
  return [...syllable.normalize("NFD")].filter((char) => {
    if (!TONE_MARKS.test(char)) return true;
    if (hasTone) return false;
    hasTone = true;
    return true;
  }).join("").normalize("NFC");
}

/** Sửa lỗi dấu thanh thường gặp khi OCR đọc họ tên trên CCCD. */
export function correctVietnameseNameTones(value: string): string {
  const syllables = value.split(" ").map(keepFirstTone);
  const fixed = syllables.map((syllable, index) => {
    const fix = index < syllables.length - 1 ? NON_FINAL_SYLLABLE_FIXES[syllable.toLocaleUpperCase("vi")] : undefined;
    if (!fix) return syllable;
    return syllable === syllable.toLocaleUpperCase("vi") ? fix : fix.charAt(0) + fix.slice(1).toLocaleLowerCase("vi");
  }).join(" ");
  return restoreNameDiacritics(fixed);
}
