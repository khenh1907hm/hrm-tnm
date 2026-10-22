import type { Repository, AuditRepository, ReminderLogEntry, ReminderLogRepository, SettingsRepository } from "../interfaces";
import type { AuditEvent } from "../../modules/audit/types";
import type { HrSettings } from "../../modules/settings/types";
import { paginate, type Page, type PageInput } from "../../lib/paginate";

export class MemoryRepository<T extends { id: string; version: number }> implements Repository<T> {
  private readonly records = new Map<string, T>();
  constructor(initial: readonly T[] = []) {
    for (const value of initial) this.records.set(value.id, structuredClone(value));
  }
  async get(id: string): Promise<T | null> { const value = this.records.get(id); return value ? structuredClone(value) : null; }
  async list(): Promise<T[]> { return [...this.records.values()].map((value) => structuredClone(value)); }
  async insert(value: T): Promise<void> { if (this.records.has(value.id)) throw new Error("duplicate id"); this.records.set(value.id, structuredClone(value)); }
  async replace(value: T, expectedVersion: number): Promise<boolean> {
    const current = this.records.get(value.id);
    if (!current || current.version !== expectedVersion) return false;
    this.records.set(value.id, structuredClone(value)); return true;
  }
  async remove(id: string): Promise<boolean> { return this.records.delete(id); }
  async replaceAndInsert(before: T, after: T, expectedVersion: number): Promise<boolean> {
    const current = this.records.get(before.id);
    if (!current || current.version !== expectedVersion || this.records.has(after.id)) return false;
    this.records.set(before.id, structuredClone(before));
    this.records.set(after.id, structuredClone(after));
    return true;
  }
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(structuredClone(event)); }
  async list(): Promise<AuditEvent[]> { return this.events.map((event) => structuredClone(event)); }
  async listPage(input: PageInput = {}): Promise<Page<AuditEvent>> {
    return paginate(await this.list(), { ...input, compare: (a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0, direction: "desc" });
  }
}

export const DEFAULT_SETTINGS: HrSettings = { reminderEmails: [], sendExpiredNotice: false, reminderDays: 30, version: 0 };

export class MemorySettingsRepository implements SettingsRepository {
  private value: HrSettings = structuredClone(DEFAULT_SETTINGS);
  async get(): Promise<HrSettings> { return structuredClone(this.value); }
  async replace(value: HrSettings, expectedVersion: number): Promise<boolean> {
    if (this.value.version !== expectedVersion) return false;
    this.value = structuredClone(value); return true;
  }
}

export class MemoryReminderLogRepository implements ReminderLogRepository {
  private readonly entries: ReminderLogEntry[] = [];
  async list(): Promise<ReminderLogEntry[]> { return this.entries.map((entry) => ({ ...entry })); }
  async add(entry: ReminderLogEntry): Promise<void> { this.entries.push({ ...entry }); }
}

