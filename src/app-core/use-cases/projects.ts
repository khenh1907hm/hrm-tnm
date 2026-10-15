import { failure, success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { validateProject } from "../../modules/projects/rules";
import type { Project, ProjectInput } from "../../modules/projects/types";
import { err, type HrAppContext } from "../context";

export function createProjectUseCases(ctx: HrAppContext) {
  const { deps, repositories, has, writeAudit, nowDate } = ctx;
  const projects = repositories.projects;
  const activeEmployeeIds = async () => (await repositories.employees.list()).filter((employee) => employee.archivedAt === null).map((employee) => employee.id);
  /** Khi sửa: người đã có trong dự án nhưng nay bị lưu trữ vẫn được giữ lại. */
  const allowedIds = async (keep: readonly string[] = []) => [...new Set([...(await activeEmployeeIds()), ...keep])];

  return {
    list: async (actor: Actor, includeArchived = false): Promise<Result<Project[]>> => {
      if (!has(actor, "projectRead")) return err("FORBIDDEN");
      const list = (await projects.list()).filter((project) => includeArchived || project.archivedAt === null);
      return success(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    get: async (actor: Actor, id: string): Promise<Result<Project>> => {
      if (!has(actor, "projectRead")) return err("FORBIDDEN");
      const project = await projects.get(id);
      return project ? success(project) : err("PROJECT_NOT_FOUND");
    },
    create: async (actor: Actor, input: ProjectInput): Promise<Result<Project>> => {
      if (!has(actor, "projectWrite")) return err("FORBIDDEN");
      const validation = validateProject(input, await allowedIds());
      if (validation.errors.length) return failure(validation.errors);
      const now = nowDate();
      const value: Project = { ...validation.value, id: deps.ids.next(), version: 1, createdAt: now, updatedAt: now, archivedAt: null };
      await projects.insert(value);
      await writeAudit(actor, "project.create", "project", value.id, null, value);
      return success(value);
    },
    update: async (actor: Actor, input: ProjectInput & { id: string; expectedVersion: number }): Promise<Result<Project>> => {
      if (!has(actor, "projectWrite")) return err("FORBIDDEN");
      const before = await projects.get(input.id);
      if (!before) return err("PROJECT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const validation = validateProject(input, await allowedIds(before.memberIds));
      if (validation.errors.length) return failure(validation.errors);
      const value: Project = { ...before, ...validation.value, version: before.version + 1, updatedAt: nowDate() };
      if (!await projects.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "project.update", "project", value.id, before, value);
      return success(value);
    },
    archive: async (actor: Actor, input: { id: string; expectedVersion: number }): Promise<Result<Project>> => {
      if (!has(actor, "projectWrite")) return err("FORBIDDEN");
      const before = await projects.get(input.id);
      if (!before) return err("PROJECT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const value: Project = { ...before, archivedAt: nowDate(), version: before.version + 1, updatedAt: nowDate() };
      if (!await projects.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "project.archive", "project", value.id, before, value);
      return success(value);
    },
    restore: async (actor: Actor, input: { id: string; expectedVersion: number }): Promise<Result<Project>> => {
      if (!has(actor, "projectWrite")) return err("FORBIDDEN");
      const before = await projects.get(input.id);
      if (!before) return err("PROJECT_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const value: Project = { ...before, archivedAt: null, version: before.version + 1, updatedAt: nowDate() };
      if (!await projects.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "project.restore", "project", value.id, before, value);
      return success(value);
    },
  };
}
