import { addMonths, isValidISODate } from "../../lib/dates";
import { isSafetyCertificateType, isValidSafetyGroup } from "./safetyGroup";
import { issue, type Issue } from "../../lib/result";
import { normalizeText } from "../../lib/text";
import type { Certificate, FileRef, SupplementaryFile } from "./types";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";

export type CertificateInput = {
  type: string; number: string; issueDate: string | null; expiryDate: string | null; document: FileRef | null;
  title?: string; supplementaryFiles?: SupplementaryFile[];
  safetyGroup?: number | null | undefined;
  /** Riêng chứng chỉ này không có thời hạn (vd HĐLĐ không xác định thời hạn) dù loại của nó có hạn. */
  noExpiry?: boolean | undefined;
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
  // Giấy không ghi số thì không so trùng số
  if (!number.trim()) return false;
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
  const type = availableTypes.find((candidate) => candidate.key === input.type);
  if (!type) errors.push(issue("CERT_TYPE_INVALID", "type"));
  if (title && (title.length < 2 || title.length > 60 || !/^[\p{L}\p{N}\s()\-/&.]+$/u.test(title))) errors.push(issue("CERT_TITLE_INVALID", "title"));
  // Số để trống khi giấy không ghi số; có nhập thì phải đúng dạng
  if (input.number.trim() && !/^[\p{L}\d][\p{L}\d .\-/_]{2,49}$/u.test(input.number)) errors.push(issue("CERT_NUMBER_INVALID", "number"));
  if (input.issueDate && (!isValidISODate(input.issueDate) || input.issueDate > today || input.issueDate < dob)) errors.push(issue("CERT_ISSUE_DATE_INVALID", "issueDate"));
  const expiry = input.expiryDate;
  if (expiry === null) {
    // Bỏ trống ngày hết hạn khi loại "không có thời hạn" hoặc người nhập tích "không có thời hạn" cho riêng chứng chỉ này
    if (type && !type.noExpiry && !input.noExpiry) errors.push(issue("CERT_EXPIRY_REQUIRED", "expiryDate"));
  } else {
    if (!isValidISODate(expiry)) errors.push(issue("DATE_INVALID", "expiryDate"));
    if (input.issueDate && expiry < input.issueDate) errors.push(issue("CERT_EXPIRY_BEFORE_ISSUE", "expiryDate"));
    if (input.issueDate && isValidISODate(input.issueDate) && isValidISODate(expiry) && expiry > addMonths(input.issueDate, 180)) warnings.push(issue("CERT_VALIDITY_TOO_LONG", "expiryDate", "warning"));
    if (expiry < today) warnings.push(issue("CERT_ALREADY_EXPIRED", "expiryDate", "warning"));
  }
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
