import { certificateStatus } from "../certificates/status";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";

export type ReminderKey = { certificateId: string; kind: "EXPIRING_30" | "EXPIRED"; expiryDate: string };
type Expiring = Certificate & { expiryDate: string };
export function computeDueReminders(certificates: Certificate[], employees: Employee[], today: string, sendExpiredNotice: boolean, sentKeys: string[]): { certificate: Expiring; employee: Employee; key: ReminderKey; daysLeft: number }[] {
  const results: { certificate: Expiring; employee: Employee; key: ReminderKey; daysLeft: number }[] = [];
  for (const candidate of certificates) {
    // Chứng chỉ không có thời hạn không cần nhắc
    if (candidate.state !== "current" || candidate.expiryDate === null) continue;
    const certificate: Expiring = { ...candidate, expiryDate: candidate.expiryDate };
    const employee = employees.find((entry) => entry.id === certificate.employeeId);
    if (!employee || employee.archivedAt !== null || !["active", "on_leave"].includes(employee.status)) continue;
    const { status, daysLeft } = certificateStatus(certificate.expiryDate, today);
    const kind = status === "expired" ? "EXPIRED" : "EXPIRING_30";
    if (status === "expired" ? !sendExpiredNotice : daysLeft > 30) continue;
    const key: ReminderKey = { certificateId: certificate.id, kind, expiryDate: certificate.expiryDate };
    if (sentKeys.includes(`${key.certificateId}|${key.kind}|${key.expiryDate}`)) continue;
    results.push({ certificate, employee, key, daysLeft });
  }
  return results;
}
