import { formatDate } from "../../lib/dates";
import type { Certificate } from "../certificates/types";
import { certificateDisplayName } from "../certificates/rules";
import type { CertificateTypeRecord } from "../certificate-types/types";
import type { Employee } from "../employees/types";

export function reminderEmail(employee: Employee, certificate: Certificate, daysLeft: number, profileUrl: string, certificateType?: CertificateTypeRecord): { subject: string; text: string } {
  const displayName = certificateDisplayName(certificateType ?? certificate.type, certificate.title);
  return {
    subject: `Nhắc hạn chứng chỉ ${displayName}`,
    text: `Nhân sự: ${employee.name} (${employee.code})\nChứng chỉ: ${displayName}\nSố chứng chỉ: ${certificate.number || "Không ghi số"}\nNgày hết hạn: ${certificate.expiryDate ? formatDate(certificate.expiryDate) : "Không thời hạn"}\nSố ngày còn lại: ${daysLeft}\nMở hồ sơ: ${profileUrl}`,
  };
}
