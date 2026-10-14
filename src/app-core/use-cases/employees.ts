import { diffDays } from "../../lib/dates";
import { failure, issue, success, type Result } from "../../lib/result";
import { normalizeText } from "../../lib/text";
import { maskCccd } from "../../lib/vietnam/cccd";
import type { Actor } from "../../modules/auth/permissions";
import { employeeInputSchema } from "../../modules/employees/schema";
import { validateEmployee } from "../../modules/employees/rules";
import type { Employee, EmployeeInput } from "../../modules/employees/types";
import { err, type HrAppContext } from "../context";

export type EmployeeListInput = { includeArchived?: boolean; page?: number; pageSize?: number; query?: string; position?: string; status?: Employee["status"]; missingRequiredCertificate?: boolean; expiringCertificates?: boolean; expiredCertificates?: boolean };

export function createEmployeeUseCases(ctx: HrAppContext) {
  const { deps, repositories, today, nowDate, has, writeAudit, getEmployee, getCommanderIds } = ctx;

  const employeeUseCases = {
    validate: async (actor: Actor, input: EmployeeInput & { excludeId?: string }): Promise<Result<{ valid: true }>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const shape = employeeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }));
      const existing = (await repositories.employees.list()).filter((employee) => employee.id !== input.excludeId);
      const validationInput = actor.role === "admin" || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
      const commanderIds = await getCommanderIds();
      const validation = validateEmployee(validationInput, today(), existing, input.excludeId, commanderIds);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      return success({ valid: true }, validation.warnings);
    },
    create: async (actor: Actor, input: EmployeeInput): Promise<Result<Employee>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const shape = employeeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }));
      const existing = await repositories.employees.list();
      const validationInput = actor.role === "admin" || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
      const commanderIds = await getCommanderIds();
      const validation = validateEmployee(validationInput, today(), existing, undefined, commanderIds);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const value: Employee = { ...validation.value, id: deps.ids.next(), version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: input.mismatchOverrideReason?.trim() || null };
      await repositories.employees.insert(value);
      await writeAudit(actor, "employee.create", "employee", value.id, null, value);
      return success(value, validation.warnings);
    },
    update: async (actor: Actor, input: EmployeeInput & { id: string; expectedVersion: number }): Promise<Result<Employee>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const shape = employeeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }));
      const before = await getEmployee(input.id);
      if (!before) return err("EMP_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const all = (await repositories.employees.list()).filter((employee) => employee.id !== input.id);
      const validationInput = actor.role === "admin" || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
      const commanderIds = await getCommanderIds();
      const validation = validateEmployee(validationInput, today(), all, input.id, commanderIds);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const value: Employee = { ...before, ...validation.value, version: before.version + 1, cccdMismatchOverrideReason: input.mismatchOverrideReason?.trim() || null };
      if (!await repositories.employees.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "employee.update", "employee", value.id, before, value);
      return success(value, validation.warnings);
    },
    archive: async (actor: Actor, input: { id: string; expectedVersion: number; reason: string }): Promise<Result<Employee>> => {
      if (!has(actor, "employeeArchive")) return err("FORBIDDEN");
      const before = await getEmployee(input.id);
      if (!before) return err("EMP_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (input.reason.trim().length < 3) return err("EMP_ARCHIVE_REASON", "reason");
      const value = { ...before, archivedAt: nowDate(), archivedBy: actor.id, archiveReason: input.reason.trim(), version: before.version + 1 };
      if (!await repositories.employees.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "employee.archive", "employee", value.id, before, value);
      return success(value);
    },
    restore: async (actor: Actor, input: { id: string; expectedVersion: number }): Promise<Result<Employee>> => {
      if (!has(actor, "employeeArchive")) return err("FORBIDDEN");
      const before = await getEmployee(input.id);
      if (!before) return err("EMP_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const value = { ...before, archivedAt: null, archivedBy: null, archiveReason: null, version: before.version + 1 };
      if (!await repositories.employees.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "employee.restore", "employee", value.id, before, value);
      return success(value);
    },
    get: async (actor: Actor, id: string): Promise<Result<Employee>> => {
      if (!has(actor, "employeeRead")) return err("FORBIDDEN");
      const employee = await getEmployee(id);
      if (!employee) return err("EMP_NOT_FOUND");
      return success({ ...employee, cccd: maskCccd(employee.cccd) });
    },
    list: async (actor: Actor, input: EmployeeListInput = {}): Promise<Result<{ items: Employee[]; page: number; pageSize: number; total: number }>> => {
      if (!has(actor, "employeeRead")) return err("FORBIDDEN");
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
      const query = normalizeText(input.query ?? "");
      const tokens = query.split(/\s+/).filter(Boolean);
      const [allEmployees, types, certificates] = await Promise.all([repositories.employees.list(), repositories.certificateTypes.list(), repositories.certificates.list()]);
      const matches = allEmployees.filter((employee) => {
        if (!input.includeArchived && employee.archivedAt !== null) return false;
        if (input.position && employee.position !== input.position) return false;
        if (input.status && employee.status !== input.status) return false;
        if (input.missingRequiredCertificate && !types.some((type) => !type.archived && type.requiredForPositions.includes(employee.position) && !certificates.some((certificate) => certificate.employeeId === employee.id && certificate.type === type.key && certificate.state === "current"))) return false;
        const currentCertificates = certificates.filter((certificate) => certificate.employeeId === employee.id && certificate.state === "current");
        if (input.expiringCertificates && !currentCertificates.some((certificate) => {
          const daysLeft = diffDays(today(), certificate.expiryDate);
          return daysLeft >= 0 && daysLeft <= 30;
        })) return false;
        if (input.expiredCertificates && !currentCertificates.some((certificate) => diffDays(today(), certificate.expiryDate) < 0)) return false;
        const searchable = [normalizeText(employee.name), normalizeText(employee.code), employee.phone, employee.cccd].join(" ");
        return tokens.every((token) => searchable.includes(token));
      });
      matches.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
      const items = matches.slice((page - 1) * pageSize, page * pageSize).map((employee) => ({ ...employee, cccd: maskCccd(employee.cccd) }));
      return success({ items, page, pageSize, total: matches.length });
    },
    search: async (actor: Actor, input: EmployeeListInput): Promise<Result<{ items: Employee[]; page: number; pageSize: number; total: number }>> => employeeUseCases.list(actor, input),
    revealCccd: async (actor: Actor, id: string): Promise<Result<string>> => {
      if (!has(actor, "employeeReveal")) return err("FORBIDDEN");
      const employee = await getEmployee(id);
      if (!employee) return err("EMP_NOT_FOUND");
      await writeAudit(actor, "cccd.reveal", "employee", id, null, { employeeId: id, cccd: employee.cccd });
      return success(employee.cccd);
    },
  };

  return employeeUseCases;
}
