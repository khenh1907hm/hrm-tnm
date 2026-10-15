import { success, type Result } from "../lib/result";
import type { Actor } from "../modules/auth/permissions";
import type { AuditEvent } from "../modules/audit/types";
import type { CertificateInput } from "../modules/certificates/rules";
import { messagesVi } from "../messages.vi";
import { mergeParsed, parseIdText, type ParsedId } from "../modules/ocr/parseIdText";
import { createMemoryRepositories } from "../repositories/memory/createMemoryRepositories";
import { createHrAppContext, err, type HrAppDeps } from "./context";
import { createCertificateTypeUseCases } from "./use-cases/certificateTypes";
import { createCertificateUseCases } from "./use-cases/certificates";
import { createCommanderUseCases } from "./use-cases/commanders";
import { createEmployeeUseCases } from "./use-cases/employees";
import { createExportUseCases } from "./use-cases/exports";
import { createReminderUseCases } from "./use-cases/reminders";
import { createSettingsUseCases } from "./use-cases/settings";
import { createSignatureUseCases } from "./use-cases/signatures";

export type { HrAppDeps, HrRepositories, Mailer } from "./context";
export type { CertificateHealth, EmployeeFacets, EmployeeListInput, EmployeeListResult, EmployeeSort } from "./use-cases/employees";
export type { ReminderRunResult } from "./use-cases/reminders";

export function createHrApp(deps: HrAppDeps) {
  const ctx = createHrAppContext(deps, deps.repositories ?? createMemoryRepositories());
  const { repositories, has } = ctx;
  const certificateUseCases = createCertificateUseCases(ctx);
  const commanderUseCases = createCommanderUseCases(ctx);

  const app = {
    employees: createEmployeeUseCases(ctx),
    certificates: certificateUseCases,
    certificateTypes: createCertificateTypeUseCases(ctx),
    signatures: createSignatureUseCases(ctx),
    settings: createSettingsUseCases(ctx),
    exports: createExportUseCases(ctx),
    reminders: createReminderUseCases(ctx),
    ocr: { parseIdText: async (actor: Actor, text: string): Promise<Result<ParsedId>> => has(actor, "ocr") ? success(parseIdText(text)) : err("FORBIDDEN"), mergeParsed },
    audit: { list: async (actor: Actor): Promise<Result<AuditEvent[]>> => has(actor, "auditRead") ? success(await repositories.audit.list()) : err("FORBIDDEN") },
    messages: messagesVi,
  };

  Object.defineProperty(app, "commanders", {
    value: commanderUseCases,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return app as typeof app & {
    certificates: typeof certificateUseCases & {
      preview: (actor: Actor, input: CertificateInput & { employeeId: string; id?: string }) => Promise<Result<{ valid: true }>>;
    };
    commanders: typeof commanderUseCases;
  };
}
