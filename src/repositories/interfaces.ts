import type { Employee } from "../modules/employees/types";
import type { Certificate } from "../modules/certificates/types";
import type { AuditEvent } from "../modules/audit/types";
import type { CertificateTypeRecord } from "../modules/certificate-types/types";
import type { Commander } from "../modules/commanders/types";

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
export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(): Promise<AuditEvent[]>;
}
