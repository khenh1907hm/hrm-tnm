import { addMonths, isValidISODate } from "../../lib/dates";
import { issue, type Issue } from "../../lib/result";
import { validateCccd } from "../../lib/vietnam/cccd";
import { validateName } from "../../lib/vietnam/name";
import { normalizePhone, validatePhone } from "../../lib/vietnam/phone";
import type { EmployeeInput } from "./types";

export function validateEmployee(input: EmployeeInput, today: string, existing: { code: string; cccd: string; phone: string; id?: string; archivedAt?: string | null }[] = [], excludeId?: string, commanderIds: string[] = ["cmd-1", "cmd-2"]): { value: EmployeeInput; errors: Issue[]; warnings: Issue[] } {
  const phoneResult = validatePhone(input.phone);
  const value = { ...input, code: input.code.trim().toUpperCase(), companyStartDate: input.companyStartDate?.trim() || null, name: validateName(input.name).value, phone: phoneResult.value ?? normalizePhone(input.phone) };
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (items: Issue[]) => items.forEach((item) => (item.severity === "error" ? errors : warnings).push(item));
  if (!/^TNM\d{3,5}$/.test(value.code)) errors.push(issue("EMP_CODE_INVALID", "code"));
  if (existing.some((employee) => employee.code === value.code && employee.id !== excludeId)) errors.push(issue("EMP_CODE_DUPLICATE", "code"));
  add(validateName(input.name).issues);
  if (!isValidISODate(input.dob)) errors.push(issue("DATE_INVALID", "dob"));
  if (!isValidISODate(input.startDate)) errors.push(issue("DATE_INVALID", "startDate"));
  const age = isValidISODate(input.dob) ? (() => {
    const birthYear = Number(input.dob.slice(0, 4));
    const birthMonth = Number(input.dob.slice(5, 7));
    const birthDay = Number(input.dob.slice(8, 10));
    const todayYear = Number(today.slice(0, 4));
    const todayMonth = Number(today.slice(5, 7));
    const todayDay = Number(today.slice(8, 10));
    const years = todayYear - birthYear;
    const beforeBirthday = todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay);
    return beforeBirthday ? years - 1 : years;
  })() : 0;
  if (isValidISODate(input.dob)) {
    if (age < 15) errors.push(issue("EMP_AGE_TOO_YOUNG", "dob"));
    else if (age > 100) errors.push(issue("EMP_AGE_TOO_OLD", "dob"));
    else if (age < 18 || age > 65) warnings.push(issue("EMP_AGE_WARNING", "dob", "warning"));
  }
  if (isValidISODate(input.dob) && isValidISODate(input.startDate) && input.startDate < addMonths(input.dob, 180)) errors.push(issue("EMP_START_TOO_EARLY", "startDate"));
  if (input.startDate > today) warnings.push(issue("EMP_START_FUTURE", "startDate", "warning"));
  if (input.companyStartDate) {
    if (!isValidISODate(input.companyStartDate)) errors.push(issue("DATE_INVALID", "companyStartDate"));
    else if (isValidISODate(input.startDate) && input.companyStartDate < input.startDate) errors.push(issue("EMP_COMPANY_START_BEFORE_CAREER", "companyStartDate"));
    else if (input.companyStartDate > today) warnings.push(issue("EMP_COMPANY_START_FUTURE", "companyStartDate", "warning"));
  }
  add(validateCccd(input.cccd, input.dob, input.gender, input.mismatchOverrideReason));
  // CCCD chỉ không trùng với hồ sơ đang hoạt động: người cũ đã lưu trữ quay lại thì nhập hồ sơ mới được
  if (existing.some((employee) => employee.cccd === input.cccd && employee.id !== excludeId && !employee.archivedAt)) errors.push(issue("CCCD_DUPLICATE", "cccd"));
  add(phoneResult.issues);
  if (existing.some((employee) => employee.phone === value.phone && employee.id !== excludeId)) warnings.push(issue("PHONE_DUPLICATE", "phone", "warning"));
  if (input.group !== null && (!Number.isInteger(input.group) || input.group < 1 || input.group > 6)) errors.push(issue("EMP_GROUP_INVALID", "group"));
  if (input.emergencyContactId && !commanderIds.includes(input.emergencyContactId)) errors.push(issue("EMP_EMERGENCY_CONTACT_INVALID", "emergencyContactId"));
  if (input.status === "resigned" && (!input.endDate || !isValidISODate(input.endDate) || input.endDate < input.startDate || input.endDate > today)) errors.push(issue("EMP_END_DATE_INVALID", "endDate"));
  return { value, errors, warnings };
}
