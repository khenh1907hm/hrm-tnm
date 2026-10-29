import type { Employee } from "../modules/employees/types";
import type { Certificate } from "../modules/certificates/types";
import type { AuditEvent } from "../modules/audit/types";
import type { CertificateTypeRecord } from "../modules/certificate-types/types";
import type { Commander } from "../modules/commanders/types";
import type { HrSettings } from "../modules/settings/types";
import type { Signature } from "../modules/signatures/types";
import type { Page, PageInput } from "../lib/paginate";

export interface Repository<T extends { id: string; version: number }> {
  get(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  insert(value: T): Promise<void>;
  replace(value: T, expectedVersion: number): Promise<boolean>;
}
export type EmployeeRepository = Repository<Employee>;
export type CertificateRepository = Repository<Certificate> & {
  replaceAndInsert(before: Certificate, after: Certificate, expectedVersion: number): Promise<boolean>;
};
export type CertificateTypeRepository = Repository<CertificateTypeRecord>;
export type CommanderRepository = Repository<Commander>;
/** Đọc nhật ký theo trang, mới nhất trước; lọc theo loại/đối tượng nếu có. */
export type AuditQuery = { offset: number; limit: number; entityType?: string; entityId?: string };
export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(): Promise<AuditEvent[]>;
  /** Một trang nhật ký, mới nhất trước (phân trang ở nơi lưu, không nạp cả bảng). */
  listPage(input?: PageInput): Promise<Page<AuditEvent>>;
  page(query: AuditQuery): Promise<{ items: AuditEvent[]; total: number }>;
}
export type SignatureRepository = Repository<Signature> & {
  /** Xóa hẳn chữ ký; trả về false nếu không tồn tại. */
  remove(id: string): Promise<boolean>;
};
export interface SettingsRepository {
  get(): Promise<HrSettings>;
  replace(value: HrSettings, expectedVersion: number): Promise<boolean>;
}
export type ReminderLogEntry = { identity: string; certificateId: string; sentOn: string };
export interface ReminderLogRepository {
  list(): Promise<ReminderLogEntry[]>;
  add(entry: ReminderLogEntry): Promise<void>;
}

