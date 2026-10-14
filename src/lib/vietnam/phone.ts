import { issue, type Issue } from "../result";

export function normalizePhone(input: string): string {
  const compact = input.replace(/[\s.()\-]/g, "");
  if (/^\+?84\d{9}$/.test(compact)) return `0${compact.replace(/^\+?84/, "")}`;
  return compact;
}

export function validatePhone(input: string, required = true): { value: string | null; issues: Issue[] } {
  const value = normalizePhone(input);
  if (!value) return required ? { value: null, issues: [issue("PHONE_REQUIRED", "phone")] } : { value: null, issues: [] };
  if (/^01\d{9}$/.test(value)) return { value: null, issues: [issue("PHONE_OLD_11_DIGIT", "phone")] };
  if (!/^0[35789]\d{8}$/.test(value)) return { value: null, issues: [issue("PHONE_INVALID", "phone")] };
  return { value, issues: [] };
}

export function formatPhone(input: string): string {
  const value = normalizePhone(input);
  return value.length === 10 ? `${value.slice(0, 4)} ${value.slice(4, 7)} ${value.slice(7)}` : input;
}
