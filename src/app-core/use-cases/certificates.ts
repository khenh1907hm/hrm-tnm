import { addDays, diffDays } from "../../lib/dates";
import { failure, issue, success, type Result } from "../../lib/result";
import { compareNormalizedText } from "../../lib/text";
import type { Actor } from "../../modules/auth/permissions";
import { hasValidRenewalIdentity } from "../../modules/certificates/applicationRules";
import { getCertificateChecklist } from "../../modules/certificates/checklist";
import { certificateDisplayName, displayCertificateTitle, hasCertificateNumberConflict, hasCurrentTitleConflict, normalizeCertificateTitle, validateCertificate, validateCertificateAttachments, type CertificateInput } from "../../modules/certificates/rules";
import { certificateInputSchema } from "../../modules/certificates/schema";
import type { Certificate, FileRef, SupplementaryFile } from "../../modules/certificates/types";
import { err, type HrAppContext } from "../context";

export function createCertificateUseCases(ctx: HrAppContext) {
  const { deps, repositories, state: { sentReminderKeys, sentReminderDates }, today, has, writeAudit, getEmployee, getCertificate } = ctx;

  const certificateUseCases = {
    add: async (actor: Actor, input: CertificateInput & { employeeId: string }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const shape = certificateInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CERT_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const employee = await getEmployee(input.employeeId);
      if (!employee || employee.archivedAt !== null) return err("EMP_NOT_FOUND");
      const all = await repositories.certificates.list();
      const allTypes = await repositories.certificateTypes.list();
      const availableTypes = allTypes.filter((type) => !type.archived);
      const title = displayCertificateTitle(shape.data.title);
      const sameTypeCurrent = all.some((item) => item.employeeId === input.employeeId && item.type === input.type && item.state === "current");
      if (hasCertificateNumberConflict(input.employeeId, input.type, input.number, all)) return err("CERT_DUPLICATE_NUMBER", "number");
      const candidate = { id: "", employeeId: input.employeeId, type: input.type, title, state: "current" as const };
      if (hasCurrentTitleConflict(candidate, all)) return err("CERT_ALREADY_EXISTS", "title");
      if (sameTypeCurrent && !title) return err("CERT_TITLE_REQUIRED", "title");
      const normalizedInput = { ...shape.data, title, supplementaryFiles: shape.data.supplementaryFiles.map((item) => ({ ...item, label: item.label?.trim() || null })) };
      const validation = validateCertificate(normalizedInput, today(), employee.dob, availableTypes);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const document = normalizedInput.document;
      if (!document) return failure([issue("CERT_FILE_REQUIRED", "document")], validation.warnings);
      const value: Certificate = { id: deps.ids.next(), employeeId: input.employeeId, type: input.type, title, number: input.number, issueDate: input.issueDate, expiryDate: input.expiryDate, document, supplementaryFiles: normalizedInput.supplementaryFiles, state: "current", version: 1, replacedBy: null, archiveReason: null };
      await repositories.certificates.insert(value);
      await writeAudit(actor, "certificate.add", "certificate", value.id, null, value);
      const warnings = [...validation.warnings];
      if (all.some((item) => item.employeeId !== input.employeeId && item.type === input.type && item.number === input.number)) warnings.push(issue("CERT_NUMBER_OTHER_EMPLOYEE", "number", "warning"));
      return success(value, warnings);
    },
    renew: async (actor: Actor, input: CertificateInput & { id: string; expectedVersion: number }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const shape = certificateInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CERT_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const before = await getCertificate(input.id);
      if (!before) return err("CERT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (before.state !== "current") return err("CERT_NOT_CURRENT");
      if (!hasValidRenewalIdentity(before.type, before.title, input.type, shape.data.title)) return err("CERT_RENEW_TITLE_INVALID", "title");
      if (input.expiryDate <= before.expiryDate || (input.issueDate && before.issueDate && input.issueDate < before.issueDate)) return err("CERT_RENEW_DATE_INVALID", "expiryDate");
      const employee = await getEmployee(before.employeeId);
      if (!employee) return err("EMP_NOT_FOUND");
      const all = await repositories.certificates.list();
      if (hasCertificateNumberConflict(before.employeeId, before.type, input.number, all, before.id)) return err("CERT_DUPLICATE_NUMBER", "number");
      const allTypes = await repositories.certificateTypes.list();
      const availableTypes = allTypes.filter((type) => !type.archived);
      const normalizedInput = { ...shape.data, type: before.type, title: before.title, supplementaryFiles: shape.data.supplementaryFiles.map((item) => ({ ...item, label: item.label?.trim() || null })) };
      const validation = validateCertificate(normalizedInput, today(), employee.dob, availableTypes);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const document = normalizedInput.document;
      if (!document) return failure([issue("CERT_FILE_REQUIRED", "document")], validation.warnings);
      const replacementId = deps.ids.next();
      const replacement: Certificate = { id: replacementId, employeeId: before.employeeId, type: before.type, title: before.title, number: input.number, issueDate: input.issueDate, expiryDate: input.expiryDate, document, supplementaryFiles: normalizedInput.supplementaryFiles, state: "current", version: 1, replacedBy: null, archiveReason: null };
      const old = { ...before, state: "replaced" as const, replacedBy: replacement.id, version: before.version + 1 };
      if (!await repositories.certificates.replaceAndInsert(old, replacement, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificate.renew", "certificate", replacement.id, before, replacement);
      return success(replacement, validation.warnings);
    },
    update: async (actor: Actor, input: CertificateInput & { id: string; expectedVersion: number }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const shape = certificateInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CERT_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const before = await getCertificate(input.id);
      if (!before) return err("CERT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (before.state !== "current") return err("CERT_NOT_CURRENT");
      if (input.type !== before.type) return err("CERT_TYPE_INVALID", "type");
      const employee = await getEmployee(before.employeeId);
      if (!employee) return err("EMP_NOT_FOUND");
      const all = await repositories.certificates.list();
      const title = displayCertificateTitle(shape.data.title);
      const otherCurrentSameType = all.some((item) => item.id !== before.id && item.employeeId === before.employeeId && item.type === before.type && item.state === "current");
      if (otherCurrentSameType && !title) return err("CERT_TITLE_REQUIRED", "title");
      if (hasCertificateNumberConflict(before.employeeId, before.type, input.number, all, before.id)) return err("CERT_DUPLICATE_NUMBER", "number");
      const candidate = { id: before.id, employeeId: before.employeeId, type: before.type, title, state: "current" as const };
      if (hasCurrentTitleConflict(candidate, all, before.id)) return err("CERT_ALREADY_EXISTS", "title");
      const types = (await repositories.certificateTypes.list()).filter((type) => !type.archived);
      const normalizedInput = { ...shape.data, title, supplementaryFiles: shape.data.supplementaryFiles.map((item) => ({ ...item, label: item.label?.trim() || null })) };
      const validation = validateCertificate(normalizedInput, today(), employee.dob, types);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const document = normalizedInput.document;
      if (!document) return failure([issue("CERT_FILE_REQUIRED", "document")], validation.warnings);
      const value: Certificate = { ...before, type: input.type, title, number: input.number, issueDate: input.issueDate, expiryDate: input.expiryDate, document, supplementaryFiles: normalizedInput.supplementaryFiles, version: before.version + 1 };
      if (!await repositories.certificates.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificate.update", "certificate", value.id, before, value);
      return success(value, validation.warnings);
    },
    updateAttachments: async (actor: Actor, input: { id: string; expectedVersion: number; document?: FileRef; supplementaryFiles: SupplementaryFile[] }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const before = await getCertificate(input.id);
      if (!before) return err("CERT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (before.state !== "current") return err("CERT_NOT_CURRENT");
      const document = input.document ?? before.document;
      const validationErrors = validateCertificateAttachments(document, input.supplementaryFiles);
      if (validationErrors.length) return failure(validationErrors);
      const supplementaryFiles = input.supplementaryFiles.map((item) => ({ ...item, label: item.label?.trim() || null }));
      const value: Certificate = { ...before, document, supplementaryFiles, version: before.version + 1 };
      if (!await repositories.certificates.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificate.attachments.update", "certificate", value.id, before, value);
      return success(value);
    },
    archive: async (actor: Actor, input: { id: string; expectedVersion: number; reason: string }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const before = await getCertificate(input.id);
      if (!before) return err("CERT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (input.reason.trim().length < 3) return err("CERT_ARCHIVE_REASON", "reason");
      const value = { ...before, state: "archived" as const, archiveReason: input.reason.trim(), version: before.version + 1 };
      if (!await repositories.certificates.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificate.archive", "certificate", value.id, before, value);
      return success(value);
    },
    restore: async (actor: Actor, input: { id: string; expectedVersion: number }): Promise<Result<Certificate>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const before = await getCertificate(input.id);
      if (!before) return err("CERT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (before.state !== "archived") return err("CERT_NOT_ARCHIVED");
      const all = await repositories.certificates.list();
      if (all.some((item) => item.id !== before.id && item.employeeId === before.employeeId && item.type === before.type && item.state === "current" && normalizeCertificateTitle(item.title) === normalizeCertificateTitle(before.title))) return err("CERT_RESTORE_CONFLICT");
      const value = { ...before, state: "current" as const, archiveReason: null, version: before.version + 1 };
      if (!await repositories.certificates.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "certificate.restore", "certificate", value.id, before, value);
      return success(value);
    },
    listByEmployee: async (actor: Actor, employeeId: string): Promise<Result<Certificate[]>> => {
      if (!has(actor, "certificateRead")) return err("FORBIDDEN");
      return success((await repositories.certificates.list()).filter((item) => item.employeeId === employeeId));
    },
    checklist: async (actor: Actor, employeeId: string): Promise<Result<ReturnType<typeof getCertificateChecklist>>> => {
      if (!has(actor, "certificateRead")) return err("FORBIDDEN");
      const employee = await getEmployee(employeeId);
      if (!employee) return err("EMP_NOT_FOUND");
      const [types, certificates] = await Promise.all([repositories.certificateTypes.list(), repositories.certificates.list()]);
      return success(getCertificateChecklist(employee, types, certificates, today()));
    },
    listExpiring: async (actor: Actor): Promise<Result<(Certificate & { daysLeft: number; group: "expired" | "d30" | "d60"; reminderSendDate: string; reminderSent: boolean; reminderSentDate: string | null; employeeName: string; employeeCode: string; displayName: string })[]>> => {
      if (!has(actor, "certificateRead")) return err("FORBIDDEN");
      const employees = await repositories.employees.list();
      const certificates = await repositories.certificates.list();
      const certificateTypes = await repositories.certificateTypes.list();
      const result = certificates.flatMap((certificate) => {
        if (certificate.state !== "current") return [];
        const employee = employees.find((item) => item.id === certificate.employeeId);
        if (!employee || employee.archivedAt !== null) return [];
        const daysLeft = diffDays(today(), certificate.expiryDate);
        if (daysLeft > 60) return [];
        const group: "expired" | "d30" | "d60" = daysLeft < 0 ? "expired" : daysLeft <= 30 ? "d30" : "d60";
        const reminderKey = sentReminderKeys.find((key) => key.startsWith(`${certificate.id}|`) && key.endsWith(`|${certificate.expiryDate}`));
        const reminderSent = reminderKey !== undefined;
        const type = certificateTypes.find((item) => item.key === certificate.type);
        return [{ ...certificate, daysLeft, group, reminderSendDate: addDays(certificate.expiryDate, -30), reminderSent, reminderSentDate: reminderKey ? sentReminderDates.get(reminderKey) ?? null : null, employeeName: employee.name, employeeCode: employee.code, displayName: type ? certificateDisplayName(type, certificate.title) : certificateDisplayName(certificate.type, certificate.title) }];
      });
      result.sort((a, b) => a.daysLeft - b.daysLeft || compareNormalizedText(a.employeeName, b.employeeName));
      return success(result);
    },
  };

  Object.defineProperty(certificateUseCases, "checklist", { enumerable: false });
  Object.defineProperty(certificateUseCases, "preview", {
    value: async (actor: Actor, input: CertificateInput & { employeeId: string; id?: string }): Promise<Result<{ valid: true }>> => {
      if (!has(actor, "certificateWrite")) return err("FORBIDDEN");
      const shape = certificateInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => issue("CERT_INPUT_INVALID", String(item.path[0] ?? "form"))));
      const employee = await getEmployee(input.employeeId);
      if (!employee || employee.archivedAt !== null) return err("EMP_NOT_FOUND");
      const all = await repositories.certificates.list();
      const allTypes = await repositories.certificateTypes.list();
      const availableTypes = allTypes.filter((type) => !type.archived);
      const title = displayCertificateTitle(shape.data.title);
      const sameTypeCurrent = all.some((item) => item.id !== input.id && item.employeeId === input.employeeId && item.type === input.type && item.state === "current");
      if (hasCertificateNumberConflict(input.employeeId, input.type, input.number, all, input.id)) return err("CERT_DUPLICATE_NUMBER", "number");
      const candidate = { id: input.id ?? "", employeeId: input.employeeId, type: input.type, title, state: "current" as const };
      if (hasCurrentTitleConflict(candidate, all, input.id)) return err("CERT_ALREADY_EXISTS", "title");
      if (sameTypeCurrent && !title) return err("CERT_TITLE_REQUIRED", "title");
      const normalizedInput = { ...shape.data, title, supplementaryFiles: (shape.data.supplementaryFiles ?? []).map((item) => ({ ...item, label: item.label?.trim() || null })) };
      const validation = validateCertificate(normalizedInput, today(), employee.dob, availableTypes);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      if (!normalizedInput.document) return failure([issue("CERT_FILE_REQUIRED", "document")], validation.warnings);
      const warnings = [...validation.warnings];
      if (all.some((item) => item.employeeId !== input.employeeId && item.type === input.type && item.number === input.number && item.id !== input.id)) {
        warnings.push(issue("CERT_NUMBER_OTHER_EMPLOYEE", "number", "warning"));
      }
      return success({ valid: true }, warnings);
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return certificateUseCases;
}
