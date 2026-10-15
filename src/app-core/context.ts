import type { Clock } from "../lib/clock";
import { todayVN } from "../lib/clock";
import type { IdGenerator } from "../lib/ids";
import { failure, issue, type Result } from "../lib/result";
import { maskCccd } from "../lib/vietnam/cccd";
import type { Actor, Permission } from "../modules/auth/permissions";
import { can } from "../modules/auth/permissions";
import type { AuditRepository, CertificateRepository, CertificateTypeRepository, CommanderRepository, EmployeeRepository, ReminderLogRepository, SettingsRepository, SignatureRepository } from "../repositories/interfaces";
import { MemoryReminderLogRepository, MemoryRepository, MemorySettingsRepository } from "../repositories/memory/repository";
import type { Signature } from "../modules/signatures/types";

export interface Mailer { send(message: { to: string[]; subject: string; text: string }): Promise<void> }
export interface HrRepositories {
  employees: EmployeeRepository; certificates: CertificateRepository; certificateTypes: CertificateTypeRepository; commanders: CommanderRepository; audit: AuditRepository;
  /** Không truyền thì dùng bản lưu trong bộ nhớ. */
  signatures?: SignatureRepository; settings?: SettingsRepository; reminders?: ReminderLogRepository;
}
export type HrAppDeps = { clock: Clock; ids: IdGenerator; repositories?: HrRepositories; mailer?: Mailer; profileBaseUrl?: string; commanderIds?: string[] };

export type HrAppContext = ReturnType<typeof createHrAppContext>;

export const err = <T>(code: string, field?: string): Result<T> => failure([issue(code, field)]);
const auditCopy = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  if ("cccd" in value && typeof value.cccd === "string") return { ...value, cccd: maskCccd(value.cccd) };
  return structuredClone(value);
};

export function createHrAppContext(deps: HrAppDeps, given: HrRepositories) {
  const repositories = {
    ...given,
    signatures: given.signatures ?? new MemoryRepository<Signature>(),
    settings: given.settings ?? new MemorySettingsRepository(),
    reminders: given.reminders ?? new MemoryReminderLogRepository(),
  };
  const nowDate = () => deps.clock.now();
  const today = () => todayVN(deps.clock);
  const has = (actor: Actor, permission: Permission) => can(actor, permission);
  const writeAudit = async (actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown): Promise<void> => {
    await repositories.audit.append({ id: deps.ids.next(), at: nowDate(), actorId: actor.id, role: actor.role, action, entityType, entityId, before: auditCopy(before), after: auditCopy(after) });
  };
  const getEmployee = async (id: string) => repositories.employees.get(id);
  const getCertificate = async (id: string) => repositories.certificates.get(id);
  const getCommanderIds = async () => {
    if (deps.commanderIds) return deps.commanderIds;
    const list = await repositories.commanders.list();
    return list.filter((c) => !c.archived).map((c) => c.id);
  };
  /** Nhắc hạn đã gửi: khóa `certificateId|kind|expiryDate` và ngày gửi. */
  const sentReminders = async () => {
    const entries = await repositories.reminders.list();
    return { keys: entries.map((entry) => entry.identity), dates: new Map(entries.map((entry) => [entry.identity, entry.sentOn])) };
  };
  return { deps, repositories, nowDate, today, has, writeAudit, getEmployee, getCertificate, getCommanderIds, sentReminders };
}
