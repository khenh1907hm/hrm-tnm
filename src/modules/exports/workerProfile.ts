import { formatDate, formatTenure, monthsBetween } from "../../lib/dates";
import { compareCodePoint, compareNormalizedText } from "../../lib/text";
import { certificateDisplayName } from "../certificates/rules";
import type { Certificate, FileRef } from "../certificates/types";
import { currentSafetyGroups } from "../certificates/safetyGroup";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";
import type { Employee } from "../employees/types";
import type { Signature } from "../signatures/types";
import { expirySortKey, isValidOn } from "../certificates/status";

export type WorkerProfileOptions = {
  selectedCertificateIds?: string[];
  extraCertificateIds?: string[];
  includeSupplementary?: boolean;
  selectedFileIds?: string[];
};

export function getSelectableProfileCertificates(employeeId: string, signDate: string, certificates: readonly Certificate[], certificateTypes: readonly CertificateTypeRecord[]) {
  const systemTypes = certificateTypes.filter((type) => type.system && !type.archived).sort((a, b) => a.sortOrder - b.sortOrder || compareNormalizedText(a.name, b.name) || compareCodePoint(a.id, b.id));
  const employeeCertificates = certificates.filter((item) => item.employeeId === employeeId && item.state === "current" && isValidOn(item.expiryDate, signDate));
  const systemKeys = new Set(systemTypes.map((type) => type.key));
  return {
    system: systemTypes.map((type) => ({ type: type.key, displayName: type.name, certificates: employeeCertificates.filter((item) => item.type === type.key).sort((a, b) => expirySortKey(b.expiryDate).localeCompare(expirySortKey(a.expiryDate)) || compareNormalizedText(a.title, b.title) || compareCodePoint(a.id, b.id)) })),
    extra: employeeCertificates.filter((item) => !systemKeys.has(item.type)).sort((a, b) => compareNormalizedText(a.type, b.type) || compareNormalizedText(a.title, b.title) || compareCodePoint(a.id, b.id)),
  };
}

function selectedForType(certificates: readonly Certificate[], typeKey: string, signDate: string, selectedIds: readonly string[], selectionIsExplicit: boolean): Certificate[] {
  const eligible = certificates.filter((item) => item.type === typeKey && item.state === "current" && isValidOn(item.expiryDate, signDate));
  const selected = eligible.filter((item) => selectedIds.includes(item.id));
  const candidates = selectionIsExplicit ? selected : eligible;
  return [...candidates].sort((a, b) => expirySortKey(b.expiryDate).localeCompare(expirySortKey(a.expiryDate)) || compareNormalizedText(a.title, b.title) || compareCodePoint(a.id, b.id)).slice(0, 1);
}

export function buildCertificateScanSelection(
  certificates: readonly Certificate[],
  systemTypeKeys: readonly string[],
  signDate: string,
  options: WorkerProfileOptions = {},
): FileRef[] {
  const selected: Certificate[] = [];
  for (const typeKey of systemTypeKeys) selected.push(...selectedForType(certificates, typeKey, signDate, options.selectedCertificateIds ?? [], options.selectedCertificateIds !== undefined));
  const systemTypeSet = new Set(systemTypeKeys);
  const extraIds = new Set(options.extraCertificateIds ?? []);
  const extras = certificates.filter((item) => !systemTypeSet.has(item.type) && extraIds.has(item.id) && item.state === "current" && isValidOn(item.expiryDate, signDate));
  selected.push(...extras);
  const allScans = selected.flatMap((certificate) => [certificate.document, ...(options.includeSupplementary ? certificate.supplementaryFiles.map((item) => item.file) : [])]);
  if (options.selectedFileIds !== undefined) {
    const allowed = new Set(options.selectedFileIds);
    return allScans.filter((file) => allowed.has(file.id));
  }
  return allScans;
}

export function buildWorkerProfileData(
  employee: Employee,
  certificates: Certificate[],
  signer: Signature,
  signDate: string,
  certificateTypes: readonly CertificateTypeRecord[] = SYSTEM_CERTIFICATE_TYPES,
  options: WorkerProfileOptions = {},
  commander?: { name: string; role?: string; phone: string; address?: string } | null,
) {
  const systemTypes = certificateTypes.filter((type) => type.system && !type.archived).sort((a, b) => a.sortOrder - b.sortOrder || compareNormalizedText(a.name, b.name) || compareCodePoint(a.id, b.id));
  const checklist = systemTypes.map((type) => {
    const current = certificates.filter((item) => item.employeeId === employee.id && item.type === type.key && item.state === "current");
    const valid = selectedForType(current, type.key, signDate, options.selectedCertificateIds ?? [], options.selectedCertificateIds !== undefined);
    const certificate = valid[0];
    const ticked = certificate !== undefined;
    return {
      type: type.key, displayName: certificateDisplayName(type, certificate?.title ?? ""), ticked,
      note: current.length > 0 && !ticked ? "đã hết hạn" : null,
      number: certificate?.number ?? null, document: certificate?.document ?? null,
      supplementaryFiles: certificate?.supplementaryFiles ?? [], group: type.key === "atld" && ticked ? currentSafetyGroups(employee, certificates, signDate).join(", ") || null : null,
      selectedCertificateId: certificate?.id ?? null,
    };
  });
  const scans = buildCertificateScanSelection(certificates.filter((item) => item.employeeId === employee.id), systemTypes.map((type) => type.key), signDate, options);
  return {
    employee: { name: employee.name.toLocaleUpperCase("vi"), dob: formatDate(employee.dob), gender: employee.gender, home: employee.home, address: employee.address, phone: employee.phone, startDate: formatDate(employee.startDate), tenure: formatTenure(monthsBetween(employee.startDate, signDate) ?? 0) },
    signer: { name: signer.name, role: signer.role, fileId: signer.file.id }, signDate: formatDate(signDate), certificates: checklist, scans,
    emergencyContact: commander ? {
      name: commander.name,
      role: commander.role ?? "Chỉ huy trưởng công trường",
      phone: commander.phone,
      address: commander.address ?? "",
    } : null,
  };
}
