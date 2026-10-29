import { diffDays } from "../../lib/dates";
import { failure, issue, success, type Issue, type Result } from "../../lib/result";
import { normalizePageSize, paginate } from "../../lib/paginate";
import { normalizeText } from "../../lib/text";
import { maskCccd } from "../../lib/vietnam/cccd";
import type { Actor } from "../../modules/auth/permissions";
import { employeeInputSchema } from "../../modules/employees/schema";
import { validateEmployee } from "../../modules/employees/rules";
import type { Employee, EmployeeInput, EmploymentStatus } from "../../modules/employees/types";
import type { Certificate, FileRef } from "../../modules/certificates/types";
import { getCertificateChecklist, type CertificateChecklistSummary } from "../../modules/certificates/checklist";
import { err, type HrAppContext } from "../context";
import { isValidOn } from "../../modules/certificates/status";

/** Tình trạng chứng chỉ của một nhân sự (dùng cho bộ lọc nhiều lựa chọn). */
export type CertificateHealth = "ok" | "missing" | "expiring" | "expired";
export type EmployeeSort = "code" | "name" | "startDate";
export type EmployeeListInput = {
  includeArchived?: boolean; page?: number; pageSize?: number; query?: string;
  /** Lọc một giá trị (giữ để tương thích). */
  position?: string; status?: Employee["status"]; missingRequiredCertificate?: boolean; expiringCertificates?: boolean; expiredCertificates?: boolean; certificateType?: string;
  /** Lọc nhiều giá trị: trong một nhóm là "hoặc", giữa các nhóm là "và". */
  positions?: readonly string[]; statuses?: readonly EmploymentStatus[]; certificateHealth?: readonly CertificateHealth[];
  certificateTypes?: readonly string[]; certificateTypeMode?: "any" | "all";
  sort?: EmployeeSort; sortDir?: "asc" | "desc";
};
export type EmployeeFacets = { positions: Record<string, number>; statuses: Record<string, number>; certificateHealth: Record<CertificateHealth, number>; certificateTypes: Record<string, number> };
/** Kết quả từng dòng khi nhập nhiều hồ sơ (cùng thứ tự với đầu vào). */
export type EmployeeImportOutcome = { ok: true; employee: Employee | null; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] };
export type EmployeeListResult = {
  items: Employee[]; page: number; pageSize: number; total: number; totalPages: number; facets: EmployeeFacets;
  /** Tóm tắt chứng chỉ của từng người trên trang này, để danh sách không phải gọi riêng từng người. */
  certificateSummaries: Record<string, CertificateChecklistSummary>;
};

export function createEmployeeUseCases(ctx: HrAppContext) {
  const { deps, repositories, today, nowDate, has, writeAudit, getEmployee, getCommanderIds } = ctx;

  const employeeUseCases = {
    validate: async (actor: Actor, input: EmployeeInput & { excludeId?: string }): Promise<Result<{ valid: true }>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const shape = employeeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }));
      const existing = (await repositories.employees.list()).filter((employee) => employee.id !== input.excludeId);
      const validationInput = has(actor, "employeeWrite") || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
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
      const validationInput = has(actor, "employeeWrite") || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
      const commanderIds = await getCommanderIds();
      const validation = validateEmployee(validationInput, today(), existing, undefined, commanderIds);
      if (validation.errors.length) return failure(validation.errors, validation.warnings);
      const value: Employee = { ...validation.value, id: deps.ids.next(), version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: input.mismatchOverrideReason?.trim() || null };
      await repositories.employees.insert(value);
      await writeAudit(actor, "employee.create", "employee", value.id, null, value);
      return success(value, validation.warnings);
    },
    /**
     * Nhập nhiều hồ sơ (từ Excel). Đọc danh sách sẵn có một lần, kiểm tra từng dòng với dữ liệu cũ
     * và các dòng phía trên (bắt trùng mã/CCCD ngay trong file). dryRun: chỉ kiểm tra, không lưu.
     */
    importMany: async (actor: Actor, input: { rows: readonly EmployeeInput[]; dryRun: boolean }): Promise<Result<EmployeeImportOutcome[]>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      // Mỗi bản ghi cần id: validateEmployee chỉ tính trùng với bản ghi có id khác bản đang kiểm tra
      const known: { code: string; cccd: string; phone: string; id: string }[] = await repositories.employees.list();
      const commanderIds = await getCommanderIds();
      const outcomes: EmployeeImportOutcome[] = [];
      for (const row of input.rows) {
        const shape = employeeInputSchema.safeParse(row);
        if (!shape.success) { outcomes.push({ ok: false, errors: shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }), warnings: [] }); continue; }
        // Nhập hàng loạt không cho ghi đè lệch CCCD: dòng lệch phải sửa trong file hoặc nhập tay
        const validation = validateEmployee({ ...row, mismatchOverrideReason: "" }, today(), known, undefined, commanderIds);
        if (validation.errors.length) { outcomes.push({ ok: false, errors: validation.errors, warnings: validation.warnings }); continue; }
        known.push({ ...validation.value, id: `import-row-${outcomes.length}` });
        if (input.dryRun) { outcomes.push({ ok: true, employee: null, warnings: validation.warnings }); continue; }
        const value: Employee = { ...validation.value, id: deps.ids.next(), version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null };
        try {
          await repositories.employees.insert(value);
          await writeAudit(actor, "employee.import", "employee", value.id, null, value);
          outcomes.push({ ok: true, employee: value, warnings: validation.warnings });
        } catch {
          known.pop();
          outcomes.push({ ok: false, errors: [issue("EMP_IMPORT_SAVE_FAILED")], warnings: [] });
        }
      }
      return success(outcomes);
    },
    update: async (actor: Actor, input: EmployeeInput & { id: string; expectedVersion: number }): Promise<Result<Employee>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const shape = employeeInputSchema.safeParse(input);
      if (!shape.success) return failure(shape.error.issues.map((item) => { const field = String(item.path[0] ?? "form"); return issue(field === "position" ? "EMP_POSITION_INVALID" : field === "group" ? "EMP_GROUP_INVALID" : "EMP_INPUT_INVALID", field); }));
      const before = await getEmployee(input.id);
      if (!before) return err("EMP_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const all = (await repositories.employees.list()).filter((employee) => employee.id !== input.id);
      const validationInput = has(actor, "employeeWrite") || input.mismatchOverrideReason === undefined ? input : { ...input, mismatchOverrideReason: "" };
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
      // Khôi phục sẽ có hai hồ sơ hoạt động cùng CCCD nếu đã có hồ sơ mới cho người này
      if ((await repositories.employees.list()).some((employee) => employee.id !== before.id && !employee.archivedAt && employee.cccd === before.cccd)) return err("CCCD_DUPLICATE_ACTIVE", "cccd");
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
    list: async (actor: Actor, input: EmployeeListInput = {}): Promise<Result<EmployeeListResult>> => {
      if (!has(actor, "employeeRead")) return err("FORBIDDEN");
      const tokens = normalizeText(input.query ?? "").split(/\s+/).filter(Boolean);
      const [allEmployees, types, certificates] = await Promise.all([repositories.employees.list(), repositories.certificateTypes.list(), repositories.certificates.list()]);
      const todayValue = today();
      const positions = [...(input.positions ?? []), ...(input.position ? [input.position] : [])];
      const statuses = [...(input.statuses ?? []), ...(input.status ? [input.status] : [])];
      const healthFilter = input.certificateHealth ?? [];
      // Cờ cũ: phải thỏa đồng thời (và)
      const requiredHealth: CertificateHealth[] = [...(input.missingRequiredCertificate ? ["missing" as const] : []), ...(input.expiringCertificates ? ["expiring" as const] : []), ...(input.expiredCertificates ? ["expired" as const] : [])];
      const typeFilter = [...(input.certificateTypes ?? []), ...(input.certificateType ? [input.certificateType] : [])];
      // Tick nhiều ô chứng chỉ thì người đó phải thỏa đủ tất cả (trừ khi chọn "một trong")
      const typeMode = input.certificateTypeMode ?? "all";

      // Gom chứng chỉ hiện hành theo người một lần, thay vì lọc cả bảng cho từng người
      const currentByEmployee = new Map<string, Certificate[]>();
      for (const certificate of certificates) {
        if (certificate.state !== "current") continue;
        const list = currentByEmployee.get(certificate.employeeId);
        if (list) list.push(certificate); else currentByEmployee.set(certificate.employeeId, [certificate]);
      }

      // Tính sẵn cho từng người: tình trạng chứng chỉ và các loại còn hạn
      type Row = { employee: Employee; health: Set<CertificateHealth>; validTypes: Set<string> };
      const rows: Row[] = allEmployees
        // Tên, mã, SĐT khớp một phần (không dấu); CCCD chỉ khớp chính xác cả 12 số
        .filter((employee) => (input.includeArchived || employee.archivedAt === null) && tokens.every((token) => token === employee.cccd || [normalizeText(employee.name), normalizeText(employee.code), employee.phone].join(" ").includes(token)))
        .map((employee) => {
          const current = currentByEmployee.get(employee.id) ?? [];
          const health = new Set<CertificateHealth>();
          if (types.some((type) => !type.archived && type.requiredForPositions.includes(employee.position) && !current.some((certificate) => certificate.type === type.key))) health.add("missing");
          for (const certificate of current) {
            // Không có thời hạn: luôn còn hiệu lực
            if (certificate.expiryDate === null) continue;
            const daysLeft = diffDays(todayValue, certificate.expiryDate);
            if (daysLeft < 0) health.add("expired"); else if (daysLeft <= 30) health.add("expiring");
          }
          if (!health.size) health.add("ok");
          return { employee, health, validTypes: new Set(current.filter((certificate) => isValidOn(certificate.expiryDate, todayValue)).map((certificate) => certificate.type)) };
        });

      type Group = "positions" | "statuses" | "certificateHealth" | "certificateTypes";
      const tests: Record<Group, (row: Row) => boolean> = {
        positions: (row) => !positions.length || positions.includes(row.employee.position),
        statuses: (row) => !statuses.length || statuses.includes(row.employee.status),
        certificateHealth: (row) => healthFilter.every((value) => row.health.has(value)) && requiredHealth.every((value) => row.health.has(value)),
        certificateTypes: (row) => !typeFilter.length || (typeMode === "all" ? typeFilter.every((type) => row.validTypes.has(type)) : typeFilter.some((type) => row.validTypes.has(type))),
      };
      const groups = Object.keys(tests) as Group[];
      const passesExcept = (row: Row, skip: Group | null) => groups.every((group) => group === skip || tests[group](row));

      // Số đếm cạnh mỗi ô tick: áp dụng mọi nhóm lọc khác, trừ chính nhóm đó
      const facets: EmployeeFacets = { positions: {}, statuses: {}, certificateHealth: { ok: 0, missing: 0, expiring: 0, expired: 0 }, certificateTypes: {} };
      const bump = (bucket: Record<string, number>, key: string) => { bucket[key] = (bucket[key] ?? 0) + 1; };
      for (const row of rows) {
        if (passesExcept(row, "positions")) bump(facets.positions, row.employee.position);
        if (passesExcept(row, "statuses")) bump(facets.statuses, row.employee.status);
        if (passesExcept(row, "certificateHealth")) for (const value of row.health) bump(facets.certificateHealth, value);
        if (passesExcept(row, "certificateTypes")) for (const type of row.validTypes) bump(facets.certificateTypes, type);
      }

      const sortKey = input.sort ?? "code";
      const compare = (a: Employee, b: Employee) => (sortKey === "name" ? a.name.localeCompare(b.name, "vi") : sortKey === "startDate" ? a.startDate.localeCompare(b.startDate) : 0) || a.code.localeCompare(b.code, "en", { numeric: true });
      const matches = rows.filter((row) => passesExcept(row, null)).map((row) => row.employee);
      const { items: pageEmployees, page, pageSize, total, totalPages } = paginate(matches, { page: input.page, pageSize: normalizePageSize(input.pageSize), compare, direction: input.sortDir });
      const certificateSummaries = Object.fromEntries(pageEmployees.map((employee) => [employee.id, getCertificateChecklist(employee, types, currentByEmployee.get(employee.id) ?? [], todayValue).summary]));
      const items = pageEmployees.map((employee) => ({ ...employee, cccd: maskCccd(employee.cccd) }));
      return success({ items, page, pageSize, total, totalPages, facets, certificateSummaries });
    },
    search: async (actor: Actor, input: EmployeeListInput): Promise<Result<EmployeeListResult>> => employeeUseCases.list(actor, input),
    /** Lưu giá trị trường tùy chỉnh theo nhân sự; `files[key] = null` là xóa ảnh. */
    updateExtra: async (actor: Actor, input: { id: string; expectedVersion: number; fields: Record<string, string>; files: Record<string, FileRef | null> }): Promise<Result<Employee>> => {
      if (!has(actor, "employeeWrite")) return err("FORBIDDEN");
      const before = await getEmployee(input.id);
      if (!before) return err("EMP_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const keyPattern = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
      const keys = [...Object.keys(input.fields), ...Object.keys(input.files)];
      if (keys.some((key) => !keyPattern.test(key)) || Object.values(input.fields).some((value) => value.length > 500)) return err("EMP_EXTRA_INVALID");
      const fields = Object.fromEntries(Object.entries({ ...before.extraFields, ...input.fields }).filter(([, value]) => value !== ""));
      const files = Object.fromEntries(Object.entries({ ...before.extraFiles, ...input.files }).filter((entry): entry is [string, FileRef] => entry[1] !== null));
      const value: Employee = { ...before, extraFields: fields, extraFiles: files, version: before.version + 1 };
      if (!await repositories.employees.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "employee.extra.update", "employee", value.id, before, value);
      return success({ ...value, cccd: maskCccd(value.cccd) });
    },
    revealCccd: async (actor: Actor, id: string): Promise<Result<string>> => {
      if (!has(actor, "employeeReveal")) return err("FORBIDDEN");
      const employee = await getEmployee(id);
      if (!employee) return err("EMP_NOT_FOUND");
      await writeAudit(actor, "cccd.reveal", "employee", id, null, { employeeId: id, code: employee.code, name: employee.name, cccd: employee.cccd });
      return success(employee.cccd);
    },
  };

  return employeeUseCases;
}
