import { diffDays } from "../../lib/dates";

export const REMINDER_DAYS = 30;
export type CertificateStatus = "expired" | "expiring" | "valid" | "none";
export function certificateStatus(expiryDate: null, today: string): { status: "none"; daysLeft: null };
export function certificateStatus(expiryDate: string, today: string): { status: Exclude<CertificateStatus, "none">; daysLeft: number };
export function certificateStatus(expiryDate: string | null, today: string): { status: CertificateStatus; daysLeft: number | null } {
  if (!expiryDate) return { status: "none", daysLeft: null };
  const daysLeft = diffDays(today, expiryDate);
  if (daysLeft < 0) return { status: "expired", daysLeft };
  if (daysLeft <= REMINDER_DAYS) return { status: "expiring", daysLeft };
  return { status: "valid", daysLeft };
}

export function profileCertificateStatus(expiries: string[], today: string): CertificateStatus {
  if (!expiries.length) return "none";
  const rank: Record<CertificateStatus, number> = { none: 0, valid: 1, expiring: 2, expired: 3 };
  return expiries.map((expiry) => certificateStatus(expiry, today).status).reduce<CertificateStatus>((worst, current) => rank[current] > rank[worst] ? current : worst, "none");
}
