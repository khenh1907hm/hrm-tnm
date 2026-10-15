import { addMonths, isValidISODate } from "../../lib/dates";
import { isSafetyCertificateType, isValidSafetyGroup } from "./safetyGroup";
import { issue, type Issue } from "../../lib/result";
import { normalizeText } from "../../lib/text";
import type { Certificate, FileRef, SupplementaryFile } from "./types";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";

export type CertificateInput = {
  type: string; number: string; issueDate: string | null; expiryDate: string; document: FileRef | null;
  title?: string; supplementaryFiles?: SupplementaryFile[];
  safetyGroup?: number | null | undefined;
};
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function normalizeCertificateTitle(value: string): string {
  return normalizeText(value.trim().replace(/\s+/g, " "));
}

export function displayCertificateTitle(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function certificateDisplayName(type: string | Pick<CertificateTypeRecord, "name">, title = ""): string {
  const categoryName = typeof type === "string" ? SYSTEM_CERTIFICATE_TYPES.find((candidate) => candidate.key === type)?.name ?? type : type.name;
  const displayTitle = displayCertificateTitle(title);
  return displayTitle ? `${categoryName} (${displayTitle})` : categoryName;
}

export function hasCurrentTitleConflict(certificate: Pick<Certificate, "employeeId" | "type" | "title" | "state" | "id">, certificates: readonly Certificate[], excludeId?: string): boolean {
  const titleKey = normalizeCertificateTitle(certificate.title);
  return certificates.some((item) => item.id !== (excludeId ?? certificate.id) && item.employeeId === certificate.employeeId && item.type === certificate.type && item.state === "current" && normalizeCertificateTitle(item.title) === titleKey);
}

export function hasCertificateNumberConflict(employeeId: string, type: string, number: string, certificates: readonly Certificate[], excludeId?: string): boolean {
  return certificates.some((item) => item.id !== excludeId && item.employeeId === employeeId && item.type === type && item.number.trim().toLocaleLowerCase("vi") === number.trim().toLocaleLowerCase("vi"));
}

export function validateCertificate(
  input: CertificateInput,
  today: string,
  dob: string,
  availableTypes: readonly CertificateTypeRecord[] = SYSTEM_CERTIFICATE_TYPES,
): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const title = displayCertificateTitle(input.title);
  const supplementaryFiles = input.supplementaryFiles ?? [];
  if (!availableTypes.some((type) => type.key === input.type)) errors.push(issue("CERT_TYPE_INVALID", "type"));
  if (title && (title.length < 2 || title.length > 60 || !/^[\p{L}\p{N}\s()\-/&.]+$/u.test(title))) errors.push(issue("CERT_TITLE_INVALID", "title"));
  if (!/^[\p{L}\d][\p{L}\d .\-/_]{2,49}$/u.test(input.number)) errors.push(issue("CERT_NUMBER_INVALID", "number"));
  if (!isValidISODate(input.expiryDate)) errors.push(issue("DATE_INVALID", "expiryDate"));
  if (input.issueDate && (!isValidISODate(input.issueDate) || input.issueDate > today || input.issueDate < dob)) errors.push(issue("CERT_ISSUE_DATE_INVALID", "issueDate"));
  if (input.issueDate && input.expiryDate < input.issueDate) errors.push(issue("CERT_EXPIRY_BEFORE_ISSUE", "expiryDate"));
  if (input.issueDate && isValidISODate(input.issueDate) && isValidISODate(input.expiryDate) && input.expiryDate > addMonths(input.issueDate, 180)) warnings.push(issue("CERT_VALIDITY_TOO_LONG", "expiryDate", "warning"));
  if (input.expiryDate < today) warnings.push(issue("CERT_ALREADY_EXPIRED", "expiryDate", "warning"));
  const checkFile = (file: FileRef | null, field: string, required: boolean) => {
    if (!file) { if (required) errors.push(issue("CERT_FILE_REQUIRED", field)); return; }
    if (!allowedMime.has(file.mime) || file.size <= 0 || file.size > MAX_FILE_SIZE) errors.push(issue("CERT_FILE_INVALID", field));
  };
  checkFile(input.document, "document", true);
  if (isSafetyCertificateType(input.type) && input.safetyGroup !== undefined && input.safetyGroup !== null && !isValidSafetyGroup(input.safetyGroup)) errors.push(issue("CERT_SAFETY_GROUP_INVALID", "safetyGroup"));
  if (supplementaryFiles.length > 10) errors.push(issue("CERT_SUPPLEMENT_COUNT_INVALID", "supplementaryFiles"));
  supplementaryFiles.forEach((attachment, index) => {
    checkFile(attachment.file, `supplementaryFiles.${index}.file`, true);
    if (attachment.label && attachment.label.trim().length > 100) errors.push(issue("CERT_SUPPLEMENT_LABEL_INVALID", `supplementaryFiles.${index}.label`));
  });
  return { errors, warnings };
}

export function validateCertificateAttachments(document: FileRef | null, supplementaryFiles: readonly SupplementaryFile[]): Issue[] {
  const errors: Issue[] = [];
  const check = (file: FileRef | null, field: string) => {
    if (!file || !allowedMime.has(file.mime) || file.size <= 0 || file.size > MAX_FILE_SIZE) errors.push(issue(file ? "CERT_FILE_INVALID" : "CERT_FILE_REQUIRED", field));
  };
  check(document, "document");
  if (supplementaryFiles.length > 10) errors.push(issue("CERT_SUPPLEMENT_COUNT_INVALID", "supplementaryFiles"));
  supplementaryFiles.forEach((attachment, index) => {
    check(attachment.file, `supplementaryFiles.${index}.file`);
    if (attachment.label && attachment.label.trim().length > 100) errors.push(issue("CERT_SUPPLEMENT_LABEL_INVALID", `supplementaryFiles.${index}.label`));
  });
  return errors;
}
