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

/** Còn hiệu lực tại ngày `date`. Chứng chỉ không có thời hạn (expiryDate null) luôn còn hiệu lực. */
export function isValidOn(expiryDate: string | null, date: string): boolean {
  return expiryDate === null || expiryDate >= date;
}

/** Khóa sắp xếp theo hạn: không có thời hạn coi như hạn xa nhất. */
export const expirySortKey = (expiryDate: string | null) => expiryDate ?? "9999-12-31";

/** Hiển thị ngày hết hạn dd/mm/yyyy, hoặc "Không thời hạn". */
export function formatExpiry(expiryDate: string | null): string {
  if (expiryDate === null) return "Không thời hạn";
  const [year, month, day] = expiryDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Trạng thái hạn của một chứng chỉ đã có: không có thời hạn thì là "valid", không đếm số ngày. */
export function expiryStatus(expiryDate: string | null, today: string): { status: Exclude<CertificateStatus, "none">; daysLeft: number | null } {
  return expiryDate === null ? { status: "valid", daysLeft: null } : certificateStatus(expiryDate, today);
}

export function profileCertificateStatus(expiries: (string | null)[], today: string): CertificateStatus {
  if (!expiries.length) return "none";
  const rank: Record<CertificateStatus, number> = { none: 0, valid: 1, expiring: 2, expired: 3 };
  return expiries.map((expiry) => expiryStatus(expiry, today).status).reduce<CertificateStatus>((worst, current) => rank[current] > rank[worst] ? current : worst, "none");
}
