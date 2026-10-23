import { failure, issue, success, type Result } from "../../lib/result";
import { compareCodePoint, compareNormalizedText, normalizeText } from "../../lib/text";
import { POSITIONS } from "../employees/types";
import type { CertificateTypeInput, CertificateTypeRecord } from "./types";

export function sortCertificateTypes(types: readonly CertificateTypeRecord[]): CertificateTypeRecord[] {
  return types.filter((type) => !type.archived).map((type) => structuredClone(type)).sort((a, b) => a.sortOrder - b.sortOrder || compareNormalizedText(a.name, b.name) || compareCodePoint(a.id, b.id));
}

export function validateCertificateTypeInput(input: CertificateTypeInput, existing: readonly CertificateTypeRecord[], excludeId?: string): Result<{ name: string; englishName: string | null; requiredForPositions: CertificateTypeInput["requiredForPositions"] }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const englishName = input.englishName?.trim().replace(/\s+/g, " ") || null;
  const errors = [];
  if (name.length < 2 || name.length > 100) errors.push(issue("CTYPE_NAME_INVALID", "name"));
  if (existing.some((type) => type.id !== excludeId && normalizeText(type.name) === normalizeText(name))) errors.push(issue("CTYPE_NAME_DUPLICATE", "name"));
  if (englishName && englishName.length > 100) errors.push(issue("CTYPE_ENGLISH_NAME_INVALID", "englishName"));
  if (!Array.isArray(input.requiredForPositions) || input.requiredForPositions.some((position) => !POSITIONS.includes(position))) errors.push(issue("CTYPE_POSITION_INVALID", "requiredForPositions"));
  if (errors.length) return failure(errors);
  return success({ name, englishName, requiredForPositions: [...new Set(input.requiredForPositions)] });
}

export function createCertificateType(input: CertificateTypeInput, existing: readonly CertificateTypeRecord[], id: string): Result<CertificateTypeRecord> {
  const validation = validateCertificateTypeInput(input, existing);
  if (!validation.ok) return validation;
  const nextOrder = existing.reduce((max, type) => Math.max(max, type.sortOrder), 0) + 1;
  const key = `custom-${id}`;
  if (existing.some((type) => type.id === id || type.key === key)) return failure([issue("CTYPE_ID_DUPLICATE", "id")]);
  return success({ id, key, ...validation.value, noExpiry: input.noExpiry === true, sortOrder: nextOrder, system: false, archived: false, archiveReason: null, version: 1 });
}

export function updateCertificateType(before: CertificateTypeRecord, input: CertificateTypeInput, sortOrder: number, existing: readonly CertificateTypeRecord[]): Result<CertificateTypeRecord> {
  const validation = validateCertificateTypeInput(input, existing, before.id);
  if (!validation.ok) return validation;
  if (!Number.isInteger(sortOrder) || sortOrder < 1) return failure([issue("CTYPE_SORT_ORDER_INVALID", "sortOrder")]);
  // Không gửi noExpiry (form cũ) thì giữ nguyên thiết lập; chứng chỉ đã lưu không hạn vẫn còn hiệu lực nếu sau này tắt
  return success({ ...before, ...validation.value, noExpiry: input.noExpiry ?? before.noExpiry ?? false, sortOrder, version: before.version + 1 });
}

export function archiveCertificateType(before: CertificateTypeRecord, reason: string, hasCurrentCertificates: boolean): Result<CertificateTypeRecord> {
  if (before.system) return failure([issue("CTYPE_SYSTEM_CANNOT_ARCHIVE", "id")]);
  if (before.archived) return failure([issue("CTYPE_ALREADY_ARCHIVED", "id")]);
  if (hasCurrentCertificates) return failure([issue("CTYPE_HAS_CURRENT_CERTIFICATES", "id")]);
  if (reason.trim().length < 3) return failure([issue("CTYPE_ARCHIVE_REASON", "reason")]);
  return success({ ...before, archived: true, archiveReason: reason.trim(), version: before.version + 1 });
}

