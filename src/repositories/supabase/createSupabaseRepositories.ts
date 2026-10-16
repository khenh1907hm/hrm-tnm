import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent } from "../../modules/audit/types";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import type { HrSettings } from "../../modules/settings/types";
import type { Signature } from "../../modules/signatures/types";
import type { AuditQuery, AuditRepository, ReminderLogEntry, ReminderLogRepository, Repository, SettingsRepository } from "../interfaces";

type Versioned = { id: string; version: number };
type Columns<T> = (value: T) => Record<string, unknown>;

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Lỗi cơ sở dữ liệu: ${result.error.message}`);
  return result.data;
}

/**
 * Bảng dạng tài liệu: `id`, `version`, `doc` (JSONB) + các cột phụ để đánh chỉ mục/ràng buộc.
 * Cập nhật chỉ thành công khi `version` trong DB khớp phiên bản mong đợi (khóa lạc quan).
 */
export class SupabaseDocRepository<T extends Versioned> implements Repository<T> {
  constructor(private readonly client: SupabaseClient, private readonly table: string, private readonly columns: Columns<T> = () => ({})) {}

  private row(value: T) {
    return { id: value.id, version: value.version, ...this.columns(value), doc: value };
  }

  async get(id: string): Promise<T | null> {
    const data = check(await this.client.from(this.table).select("doc").eq("id", id).maybeSingle());
    return data ? (data.doc as T) : null;
  }

  async list(): Promise<T[]> {
    const data = check(await this.client.from(this.table).select("doc").order("created_at", { ascending: true }));
    return (data ?? []).map((item: { doc: unknown }) => item.doc as T);
  }

  async insert(value: T): Promise<void> {
    check(await this.client.from(this.table).insert(this.row(value)));
  }

  async replace(value: T, expectedVersion: number): Promise<boolean> {
    const data = check(await this.client.from(this.table).update(this.row(value)).eq("id", value.id).eq("version", expectedVersion).select("id"));
    return (data ?? []).length === 1;
  }

  async remove(id: string): Promise<boolean> {
    const data = check(await this.client.from(this.table).delete().eq("id", id).select("id"));
    return (data ?? []).length === 1;
  }
}

const certificateColumns: Columns<Certificate> = (value) => ({ employee_id: value.employeeId, type: value.type, state: value.state, expiry_date: value.expiryDate });

export class SupabaseCertificateRepository extends SupabaseDocRepository<Certificate> {
  constructor(private readonly db: SupabaseClient) { super(db, "certificates", certificateColumns); }

  /** Gia hạn: cập nhật bản cũ và thêm bản mới trong một giao dịch (hàm renew_certificate). */
  async replaceAndInsert(before: Certificate, after: Certificate, expectedVersion: number): Promise<boolean> {
    return Boolean(check(await this.db.rpc("renew_certificate", { p_old_id: before.id, p_expected_version: expectedVersion, p_old: before, p_new: after })));
  }
}

export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly client: SupabaseClient) {}

  async append(event: AuditEvent): Promise<void> {
    check(await this.client.from("audit_events").insert({ id: event.id, at: event.at, actor_id: event.actorId, action: event.action, entity_type: event.entityType, entity_id: event.entityId, doc: event }));
  }

  async list(): Promise<AuditEvent[]> {
    const data = check(await this.client.from("audit_events").select("doc").order("at", { ascending: true }));
    return (data ?? []).map((item: { doc: unknown }) => item.doc as AuditEvent);
  }

  async page(query: AuditQuery): Promise<{ items: AuditEvent[]; total: number }> {
    let request = this.client.from("audit_events").select("doc", { count: "exact" });
    if (query.entityType) request = request.eq("entity_type", query.entityType);
    if (query.entityId) request = request.eq("entity_id", query.entityId);
    const { data, error, count } = await request.order("at", { ascending: false }).order("id", { ascending: false }).range(query.offset, query.offset + query.limit - 1);
    if (error) throw new Error(error.message);
    return { items: (data ?? []).map((item: { doc: unknown }) => item.doc as AuditEvent), total: count ?? 0 };
  }
}

export class SupabaseSettingsRepository implements SettingsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get(): Promise<HrSettings> {
    const data = check(await this.client.from("settings").select("version, doc").eq("id", "global").single()) as { version: number; doc: Omit<HrSettings, "version"> };
    return { reminderEmails: data.doc.reminderEmails ?? [], sendExpiredNotice: Boolean(data.doc.sendExpiredNotice), reminderDays: 30, version: data.version };
  }

  async replace(value: HrSettings, expectedVersion: number): Promise<boolean> {
    const { version, ...doc } = value;
    const data = check(await this.client.from("settings").update({ version, doc }).eq("id", "global").eq("version", expectedVersion).select("id"));
    return (data ?? []).length === 1;
  }
}

export class SupabaseReminderLogRepository implements ReminderLogRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<ReminderLogEntry[]> {
    const data = check(await this.client.from("reminder_log").select("identity, certificate_id, sent_on"));
    return (data ?? []).map((item: { identity: string; certificate_id: string; sent_on: string }) => ({ identity: item.identity, certificateId: item.certificate_id, sentOn: item.sent_on }));
  }

  async add(entry: ReminderLogEntry): Promise<void> {
    check(await this.client.from("reminder_log").insert({ identity: entry.identity, certificate_id: entry.certificateId, sent_on: entry.sentOn }));
  }
}

export function createSupabaseRepositories(client: SupabaseClient) {
  return {
    employees: new SupabaseDocRepository<Employee>(client, "employees", (value) => ({ code: value.code, cccd: value.cccd })),
    certificates: new SupabaseCertificateRepository(client),
    certificateTypes: new SupabaseDocRepository<CertificateTypeRecord>(client, "certificate_types", (value) => ({ key: value.key })),
    commanders: new SupabaseDocRepository<Commander>(client, "commanders"),
    audit: new SupabaseAuditRepository(client),
    signatures: new SupabaseDocRepository<Signature>(client, "signatures"),
    settings: new SupabaseSettingsRepository(client),
    reminders: new SupabaseReminderLogRepository(client),
  };
}
