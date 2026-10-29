import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import { canArchiveCommander, sortCommanders, validateCommander } from "../../modules/commanders/rules";
import type { Commander, CommanderInput } from "../../modules/commanders/types";
import { err, type HrAppContext } from "../context";

export function createCommanderUseCases(ctx: HrAppContext) {
  const { deps, repositories, has, writeAudit } = ctx;

  const commanderUseCases = {
    list: async (actor: Actor, includeArchived = false): Promise<Result<Commander[]>> => {
      if (!has(actor, "commanderRead")) return err("FORBIDDEN");
      const list = await repositories.commanders.list();
      const filtered = has(actor, "commanderWrite") && includeArchived ? list : list.filter((item) => !item.archived);
      return success(sortCommanders(filtered));
    },
    create: async (actor: Actor, input: CommanderInput): Promise<Result<Commander>> => {
      if (!has(actor, "commanderWrite")) return err("FORBIDDEN");
      const existing = await repositories.commanders.list();
      const validation = validateCommander(input, existing);
      if (!validation.ok) return validation;
      const value: Commander = { ...validation.value, id: deps.ids.next(), archived: false, version: 1 };
      await repositories.commanders.insert(value);
      await writeAudit(actor, "commander.create", "commander", value.id, null, value);
      return success(value);
    },
    update: async (actor: Actor, input: CommanderInput & { id: string; expectedVersion: number }): Promise<Result<Commander>> => {
      if (!has(actor, "commanderWrite")) return err("FORBIDDEN");
      const before = await repositories.commanders.get(input.id);
      if (!before) return err("COMMANDER_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      const existing = await repositories.commanders.list();
      const validation = validateCommander(input, existing, input.id);
      if (!validation.ok) return validation;
      const value: Commander = { ...before, ...validation.value, version: before.version + 1 };
      if (!await repositories.commanders.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "commander.update", "commander", value.id, before, value);
      return success(value);
    },
    archive: async (actor: Actor, input: { id: string; expectedVersion: number }): Promise<Result<Commander>> => {
      if (!has(actor, "commanderWrite")) return err("FORBIDDEN");
      const before = await repositories.commanders.get(input.id);
      if (!before) return err("COMMANDER_NOT_FOUND");
      if (before.version !== input.expectedVersion) return err("CONFLICT");
      if (before.archived) return err("COMMANDER_ALREADY_ARCHIVED");
      const employees = await repositories.employees.list();
      const canArchive = canArchiveCommander(input.id, employees);
      if (!canArchive.ok) return canArchive;
      const value: Commander = { ...before, archived: true, version: before.version + 1 };
      if (!await repositories.commanders.replace(value, input.expectedVersion)) return err("CONFLICT");
      await writeAudit(actor, "commander.archive", "commander", value.id, before, value);
      return success(value);
    },
  };

  return commanderUseCases;
}
