import { isValidISODate } from "../../lib/dates";
import { validateCccd } from "../../lib/vietnam/cccd";
import { validateName } from "../../lib/vietnam/name";
import { validatePhone } from "../../lib/vietnam/phone";
import type { EmployeeInput } from "../employees/types";
import type { ParsedId } from "./parseIdText";

export type OcrFormField = "name" | "dob" | "gender" | "cccd" | "phone" | "home" | "address" | "currentAddress";
export type OcrApplyResult = {
  parsed: ParsedId;
  raw?: Partial<Record<OcrFormField, string>>;
};
export type OcrRejectedValue = { field: OcrFormField; raw: string; reason: "invalid" | "old_id" | "identity_mismatch" };

export function applyOcrToForm(
  currentForm: EmployeeInput,
  ocrResult: OcrApplyResult,
  touchedFields: ReadonlySet<OcrFormField>,
): { nextForm: EmployeeInput; filled: OcrFormField[]; skippedBecauseTyped: OcrFormField[]; rejected: OcrRejectedValue[]; missing: OcrFormField[] } {
  const nextForm = { ...currentForm };
  const filled: OcrFormField[] = [];
  const skippedBecauseTyped: OcrFormField[] = [];
  const rejected: OcrRejectedValue[] = [];
  const candidates: Partial<Record<OcrFormField, string | null | undefined>> = {
    name: ocrResult.parsed.name ?? undefined,
    dob: ocrResult.parsed.dob ?? undefined,
    gender: ocrResult.parsed.gender ?? undefined,
    cccd: ocrResult.parsed.cccd ?? undefined,
    phone: ocrResult.parsed.phone ?? undefined,
    home: ocrResult.parsed.home ?? undefined,
    address: ocrResult.parsed.addr ?? undefined,
    currentAddress: ocrResult.parsed.currentAddr ?? undefined,
  };
  const values = ocrResult.parsed;
  for (const field of ["name", "dob", "gender", "cccd", "phone", "home", "address", "currentAddress"] as const) {
    const value = candidates[field];
    if (!value) continue;
    if (touchedFields.has(field)) { skippedBecauseTyped.push(field); continue; }
    let valid = true;
    if (field === "name") valid = validateName(value).issues.length === 0;
    if (field === "dob") valid = isValidISODate(value);
    if (field === "phone") valid = validatePhone(value).issues.length === 0;
    if (field === "cccd") {
      if (/^\d{9}$/.test(value)) {
        rejected.push({ field, raw: ocrResult.raw?.[field] ?? value, reason: "old_id" });
        continue;
      }
      valid = validateCccd(value).length === 0;
      if (valid && ((values.dob && validateCccd(value, values.dob, values.gender ?? undefined).length > 0))) {
        rejected.push({ field, raw: ocrResult.raw?.[field] ?? value, reason: "identity_mismatch" });
        continue;
      }
    }
    if (!valid) { rejected.push({ field, raw: ocrResult.raw?.[field] ?? value, reason: "invalid" }); continue; }
    if (field === "gender") nextForm.gender = value === "Nữ" ? "Nữ" : "Nam";
    else if (field === "name") nextForm.name = validateName(value).value;
    else if (field === "phone") nextForm.phone = validatePhone(value).value ?? nextForm.phone;
    else if (field === "dob") nextForm.dob = value;
    else if (field === "cccd") nextForm.cccd = value;
    else if (field === "home") nextForm.home = value;
    else if (field === "address") nextForm.address = value;
    else if (field === "currentAddress") nextForm.currentAddress = value;
    filled.push(field);
  }
  const missing: OcrFormField[] = [];
  if (!nextForm.name.trim()) missing.push("name");
  if (!nextForm.dob.trim()) missing.push("dob");
  if (!nextForm.cccd.trim()) missing.push("cccd");
  if (!nextForm.phone.trim()) missing.push("phone");
  return { nextForm, filled, skippedBecauseTyped, rejected, missing };
}
