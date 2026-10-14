import type { Repository, AuditRepository } from "../interfaces";
import type { AuditEvent } from "../../modules/audit/types";

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
}
