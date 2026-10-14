import { diffDays } from "../../lib/dates";
import { compareCodePoint, compareNormalizedText } from "../../lib/text";
import { certificateDisplayName } from "./rules";
import type { Certificate } from "./types";
import type { Employee } from "../employees/types";
import type { CertificateTypeRecord } from "../certificate-types/types";

export type ChecklistStatus = "valid" | "expiring" | "expired" | "missing" | "not_required";
export type CertificateChecklistRow = {
  type: string;
  title: string;
  displayName: string;
  number: string | null;
  expiryDate: string | null;
  daysLeft: number | null;
  status: ChecklistStatus;
  statusLabel: string;
  hasPrimaryFile: boolean;
  supplementaryFileCount: number;
};
export type CertificateChecklistSummary = { missing: number; expiring: number; expired: number };

const statusLabels: Record<ChecklistStatus, string> = {
  valid: "Còn hiệu lực",
  expiring: "Sắp hết hạn",
  expired: "Đã hết hạn",
  missing: "Thiếu (bắt buộc)",
  not_required: "Chưa có",
};

function statusForExpiry(daysLeft: number): Exclude<ChecklistStatus, "missing" | "not_required"> {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return "valid";
}

export function getCertificateChecklist(
  employee: Employee,
  certificateTypes: readonly CertificateTypeRecord[],
  certificates: readonly Certificate[],
  today: string,
): { rows: CertificateChecklistRow[]; summary: CertificateChecklistSummary } {
  const activeTypes = certificateTypes
    .filter((type) => !type.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || compareNormalizedText(a.name, b.name) || compareCodePoint(a.id, b.id));
  const rows = activeTypes.flatMap<CertificateChecklistRow>((type) => {
    const current = certificates
      .filter((certificate) => certificate.employeeId === employee.id && certificate.type === type.key && certificate.state === "current")
      .sort((a, b) => compareNormalizedText(a.title, b.title) || compareCodePoint(a.id, b.id));
    if (current.length === 0) {
      const status: ChecklistStatus = type.requiredForPositions.includes(employee.position) ? "missing" : "not_required";
      return [{
        type: type.key, title: "", displayName: certificateDisplayName(type), number: null, expiryDate: null, daysLeft: null,
        status, statusLabel: statusLabels[status], hasPrimaryFile: false, supplementaryFileCount: 0,
      }];
    }
    return current.map((certificate) => {
      const daysLeft = diffDays(today, certificate.expiryDate);
      const status = statusForExpiry(daysLeft);
      return {
        type: type.key, title: certificate.title, displayName: certificateDisplayName(type, certificate.title), number: certificate.number,
        expiryDate: certificate.expiryDate, daysLeft, status, statusLabel: statusLabels[status], hasPrimaryFile: true,
        supplementaryFileCount: certificate.supplementaryFiles.length,
      };
    });
  });
  const summary = rows.reduce<CertificateChecklistSummary>((counts, row) => {
    if (row.status === "missing") counts.missing += 1;
    if (row.status === "expiring") counts.expiring += 1;
    if (row.status === "expired") counts.expired += 1;
    return counts;
  }, { missing: 0, expiring: 0, expired: 0 });
  return { rows, summary };
}
