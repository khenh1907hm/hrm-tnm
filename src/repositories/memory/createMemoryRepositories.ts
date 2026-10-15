import { MemoryAuditRepository, MemoryReminderLogRepository, MemoryRepository, MemorySettingsRepository } from "./repository";
import type { Employee } from "../../modules/employees/types";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import { SYSTEM_CERTIFICATE_TYPES } from "../../modules/certificate-types/types";
import type { Commander } from "../../modules/commanders/types";
import { DEMO_COMMANDERS } from "../../modules/commanders/types";
import type { Signature } from "../../modules/signatures/types";

export function createMemoryRepositories() {
  return {
    employees: new MemoryRepository<Employee>(),
    certificates: new MemoryRepository<Certificate>(),
    certificateTypes: new MemoryRepository<CertificateTypeRecord>(SYSTEM_CERTIFICATE_TYPES),
    commanders: new MemoryRepository<Commander>(DEMO_COMMANDERS),
    audit: new MemoryAuditRepository(),
    signatures: new MemoryRepository<Signature>(),
    settings: new MemorySettingsRepository(),
    reminders: new MemoryReminderLogRepository(),
  };
}
