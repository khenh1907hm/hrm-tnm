import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent } from "../../modules/audit/types";
import type { Certificate } from "../../modules/certificates/types";
import type { CertificateTypeRecord } from "../../modules/certificate-types/types";
import type { Commander } from "../../modules/commanders/types";
import type { Employee } from "../../modules/employees/types";
import type { HrSettings } from "../../modules/settings/types";
import type { Signature } from "../../modules/signatures/types";
import { normalizePage, normalizePageSize, type Page, type PageInput } from "../../lib/paginate";
import type { AuditRepository, ReminderLogEntry, ReminderLogRepository, Repository, SettingsRepository } from "../interfaces";

type Versioned = { id: string; version: number };
type Columns<T> = (value: T) => Record<string, unknown>;

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Lỗi cơ sở dữ liệu: ${result.error.message}`);
  return result.data;
}

/** Số dòng mỗi lô; PostgREST mặc định trả tối đa 1.000 dòng mỗi lần và cắt mà không báo lỗi. */
const BATCH_SIZE = 1000;

/**
 * Đọc cả bảng theo lô `range(0, 999)`, `range(1000, 1999)`… sắp theo khóa duy nhất để các lô không chồng, không sót.
 * Dừng khi đã đủ tổng số dòng (`count`) hoặc một lô về rỗng, nên vẫn đúng nếu máy chủ đặt trần thấp hơn 1.000.
 * Ngưỡng nâng cấp: khi một bảng vượt khoảng 10.000 dòng thì chuyển sang phân trang ở máy chủ thay vì nạp cả bảng.
 */
async function selectAll<R>(client: SupabaseClient, table: string, columns: string, key: string): Promise<R[]> {
  const rows: R[] = [];
  let total: number | null = null;
  for (;;) {
    const result = await client.from(table).select(columns, total === null ? { count: "exact" } : {}).order(key, { ascending: true }).range(rows.length, rows.length + BATCH_SIZE - 1);
    const batch = (check(result) ?? []) as R[];
    if (total === null) total = result.count ?? null;
    rows.push(...batch);
    if (!batch.length || (total !== null ? rows.length >= total : batch.length < BATCH_SIZE)) return rows;
  }
}

const byCreatedAt = (a: { id: string; created_at: string | number }, b: { id: string; created_at: string | number }) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

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

  /** Cả bảng (theo lô), giữ thứ tự tạo như trước. */
  async list(): Promise<T[]> {
    const rows = await selectAll<{ id: string; created_at: string | number; doc: unknown }>(this.client, this.table, "id, created_at, doc", "id");
    return rows.sort(byCreatedAt).map((item) => item.doc as T);
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
    const rows = await selectAll<{ id: string; at: string; doc: unknown }>(this.client, "audit_events", "id, at, doc", "id");
    return rows.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1).map((item) => item.doc as AuditEvent);
  }

  /** Một trang nhật ký ở máy chủ (mới nhất trước), không nạp cả bảng. */
  async listPage(input: PageInput = {}): Promise<Page<AuditEvent>> {
    const pageSize = normalizePageSize(input.pageSize);
    const fetchPage = async (page: number) => {
      const from = (page - 1) * pageSize;
      const result = await this.client.from("audit_events").select("doc", { count: "exact" }).order("at", { ascending: false }).order("id", { ascending: false }).range(from, from + pageSize - 1);
      return { items: ((check(result) ?? []) as { doc: unknown }[]).map((item) => item.doc as AuditEvent), total: result.count ?? 0 };
    };
    const wanted = normalizePage(input.page, Number.MAX_SAFE_INTEGER, pageSize).page;
    let fetched = await fetchPage(wanted);
    const { page, totalPages } = normalizePage(wanted, fetched.total, pageSize);
    // Trang vượt quá tổng số trang → lấy trang cuối
    if (page !== wanted) fetched = await fetchPage(page);
    return { items: fetched.items, total: fetched.total, page, pageSize, totalPages };
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

  /** Không cache (bảng tăng mãi): mỗi lần cần thì đọc theo lô. */
  async list(): Promise<ReminderLogEntry[]> {
    const rows = await selectAll<{ identity: string; certificate_id: string; sent_on: string }>(this.client, "reminder_log", "identity, certificate_id, sent_on", "identity");
    return rows.map((item) => ({ identity: item.identity, certificateId: item.certificate_id, sentOn: item.sent_on }));
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
