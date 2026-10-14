import { PROVINCE_CODES } from "./provinceCodes";
import { issue, type Issue } from "../result";

export type Gender = "Nam" | "Nữ";
export type DecodedCccd = { provinceCode: string; gender: Gender; birthYear: number };

export function decodeCccd(value: string): DecodedCccd | null {
  if (!/^\d{12}$/.test(value) || !PROVINCE_CODES.has(value.slice(0, 3))) return null;
  const centuryDigit = Number(value[3]);
  const yearSuffix = Number(value.slice(4, 6));
  return {
    provinceCode: value.slice(0, 3),
    gender: centuryDigit % 2 === 0 ? "Nam" : "Nữ",
    birthYear: 1900 + 100 * Math.floor(centuryDigit / 2) + yearSuffix,
  };
}

export function validateCccd(value: string, dob?: string, gender?: Gender, overrideReason?: string): Issue[] {
  if (/^\d{9}$/.test(value)) return [issue("CCCD_IS_OLD_CMND", "cccd")];
  if (!/^\d{12}$/.test(value)) return [issue("CCCD_INVALID", "cccd")];
  const decoded = decodeCccd(value);
  if (!decoded) return [issue("CCCD_PROVINCE_INVALID", "cccd")];
  const mismatch: Issue[] = [];
  if (dob && decoded.birthYear !== Number(dob.slice(0, 4))) mismatch.push(issue("CCCD_DOB_MISMATCH", "cccd"));
  if (gender && decoded.gender !== gender) mismatch.push(issue("CCCD_GENDER_MISMATCH", "cccd"));
  if (!mismatch.length) return [];
  if (overrideReason && overrideReason.trim().length >= 5) return mismatch.map((item) => ({ ...item, severity: "warning" }));
  return mismatch;
}

export function maskCccd(value: string): string {
  return /^\d{12}$/.test(value) ? `${value.slice(0, 3)}•••••${value.slice(-4)}` : value;
}
