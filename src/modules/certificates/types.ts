export const CERTIFICATE_TYPES = ["atld", "health", "ins", "elec", "weld", "crane", "fork"] as const;
export type CertificateType = string;
export type CertificateState = "current" | "replaced" | "archived";
export type FileRef = { id: string; name: string; mime: string; size: number };
export type SupplementaryFile = { file: FileRef; label: string | null };
export type Certificate = {
  id: string; employeeId: string; type: CertificateType; title: string; number: string; expiryDate: string;
  issueDate: string | null; document: FileRef; supplementaryFiles: SupplementaryFile[];
  state: CertificateState; version: number; replacedBy: string | null; archiveReason: string | null;
  /** Nhóm huấn luyện 1–6, chỉ dùng cho chứng chỉ An toàn lao động. */
  safetyGroup?: number | null;
};
