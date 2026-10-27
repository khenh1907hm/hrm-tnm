export const CERTIFICATE_TYPES = ["atld", "health", "ins", "elec", "weld", "crane", "fork"] as const;
export type CertificateType = string;
export type CertificateState = "current" | "replaced" | "archived";
export type FileRef = { id: string; name: string; mime: string; size: number };
export type SupplementaryFile = { file: FileRef; label: string | null };
export type Certificate = {
  /** number rỗng: giấy không ghi số. expiryDate null: loại chứng chỉ không có thời hạn (bằng cấp…), luôn còn hiệu lực. */
  id: string; employeeId: string; type: CertificateType; title: string; number: string; expiryDate: string | null;
  issueDate: string | null; document: FileRef; supplementaryFiles: SupplementaryFile[];
  state: CertificateState; version: number; replacedBy: string | null; archiveReason: string | null;
  /** Nhóm huấn luyện 1–6, chỉ dùng cho chứng chỉ An toàn lao động. */
  safetyGroup?: number | null;
};
