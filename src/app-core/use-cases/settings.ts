import { success, type Result } from "../../lib/result";
import type { Actor } from "../../modules/auth/permissions";
import type { HrSettings } from "../../modules/settings/types";
import { err, type HrAppContext } from "../context";

export function createSettingsUseCases(ctx: HrAppContext) {
  const { state, has, writeAudit } = ctx;

  const settingsUseCases = {
    get: async (actor: Actor): Promise<Result<HrSettings>> => has(actor, "settingsRead") ? success({ ...state.settings, reminderEmails: [...state.settings.reminderEmails] }) : err("FORBIDDEN"),
    update: async (actor: Actor, input: { reminderEmails: string[]; sendExpiredNotice: boolean; expectedVersion: number }): Promise<Result<HrSettings>> => {
      if (!has(actor, "settingsWrite")) return err("FORBIDDEN");
      if (input.expectedVersion !== state.settings.version) return err("CONFLICT");
      const emails = [...new Set(input.reminderEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
      if (emails.length > 10) return err("SETTING_EMAIL_LIMIT", "reminderEmails");
      if (emails.some((email) => !/^\S+@\S+\.\S+$/.test(email))) return err("SETTING_EMAIL_INVALID", "reminderEmails");
      const before = state.settings;
      state.settings = { reminderEmails: emails, sendExpiredNotice: input.sendExpiredNotice, reminderDays: 30, version: state.settings.version + 1 };
      await writeAudit(actor, "settings.update", "settings", "global", before, state.settings); return success(state.settings);
    },
  };

  return settingsUseCases;
}
