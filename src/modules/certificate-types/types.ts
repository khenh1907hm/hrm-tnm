import type { Position } from "../employees/types";

export type CertificateTypeRecord = {
  id: string;
  key: string;
  name: string;
  englishName: string | null;
  requiredForPositions: Position[];
  sortOrder: number;
  system: boolean;
  archived: boolean;
  archiveReason: string | null;
  version: number;
  /** Loại không có thời hạn (bằng cấp…): chứng chỉ không cần ngày hết hạn, luôn còn hiệu lực. Bản ghi cũ không có trường này = có hạn. */
  noExpiry?: boolean;
};

export type CertificateTypeInput = {
  name: string;
  englishName?: string | null;
  requiredForPositions: Position[];
  noExpiry?: boolean | undefined;
};

export const SYSTEM_CERTIFICATE_TYPES: readonly CertificateTypeRecord[] = [
  { id: "ctype-atld", key: "atld", name: "An toàn lao động", englishName: "Occupational safety", requiredForPositions: ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"], sortOrder: 1, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-health", key: "health", name: "Khám sức khỏe", englishName: "Health examination", requiredForPositions: ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"], sortOrder: 2, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-ins", key: "ins", name: "Bảo hiểm tai nạn lao động", englishName: "Occupational accident insurance", requiredForPositions: ["Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"], sortOrder: 3, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-elec", key: "elec", name: "An toàn điện", englishName: "Electrical safety", requiredForPositions: ["Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"], sortOrder: 4, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-weld", key: "weld", name: "Chứng chỉ hàn", englishName: "Welding certificate", requiredForPositions: [], sortOrder: 5, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-crane", key: "crane", name: "Vận hành cần cẩu", englishName: "Crane operation", requiredForPositions: [], sortOrder: 6, system: true, archived: false, archiveReason: null, version: 1 },
  { id: "ctype-fork", key: "fork", name: "Vận hành xe nâng hàng", englishName: "Forklift operation", requiredForPositions: [], sortOrder: 7, system: true, archived: false, archiveReason: null, version: 1 },
];

