import { failure, issue, success, type Result } from "../../lib/result";
import { compareCodePoint, compareNormalizedText } from "../../lib/text";
import { validateName } from "../../lib/vietnam/name";
import { normalizePhone, validatePhone } from "../../lib/vietnam/phone";
import type { Commander, CommanderInput } from "./types";

export function validateCommander(
  input: CommanderInput,
  existing: readonly Commander[] = [],
  excludeId?: string,
): Result<CommanderInput> {
  const errors = [];
  const nameTrimmed = input.name.trim().replace(/\s+/g, " ");
  const nameCheck = validateName(nameTrimmed);
  if (nameCheck.issues.length) {
    errors.push(...nameCheck.issues);
  }

  const roleTrimmed = (input.role || "Chỉ huy trưởng công trường").trim().replace(/\s+/g, " ");
  if (roleTrimmed.length < 2 || roleTrimmed.length > 100) {
    errors.push(issue("COMMANDER_ROLE_INVALID", "role"));
  }

  const phoneResult = validatePhone(input.phone);
  if (phoneResult.issues.length) {
    errors.push(...phoneResult.issues);
  }

  const addressTrimmed = input.address.trim().replace(/\s+/g, " ");
  if (addressTrimmed.length < 3 || addressTrimmed.length > 255) {
    errors.push(issue("COMMANDER_ADDRESS_INVALID", "address"));
  }

  const normalizedPhone = phoneResult.value ?? normalizePhone(input.phone);
  if (
    existing.some(
      (c) => c.id !== excludeId && !c.archived && normalizePhone(c.phone) === normalizedPhone,
    )
  ) {
    errors.push(issue("COMMANDER_PHONE_DUPLICATE", "phone"));
  }

  if (errors.length) return failure(errors);

  return success({
    name: nameCheck.value,
    role: roleTrimmed,
    phone: normalizedPhone,
    address: addressTrimmed,
  });
}

export function isCommanderInUse(
  commanderId: string,
  employees: readonly { emergencyContactId: string | null; archivedAt?: string | null }[],
): boolean {
  return employees.some(
    (employee) => (employee.archivedAt === null || employee.archivedAt === undefined) && employee.emergencyContactId === commanderId,
  );
}

export function canArchiveCommander(
  commanderId: string,
  employees: readonly { emergencyContactId: string | null; archivedAt?: string | null }[],
): Result<{ canArchive: true }> {
  if (isCommanderInUse(commanderId, employees)) {
    return failure([issue("COMMANDER_IN_USE", "commander")]);
  }
  return success({ canArchive: true });
}

export function sortCommanders(commanders: readonly Commander[]): Commander[] {
  return [...commanders].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return compareNormalizedText(a.name, b.name) || compareCodePoint(a.id, b.id);
  });
}
