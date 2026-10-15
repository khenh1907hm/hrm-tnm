import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import type { Certificate } from "../../modules/certificates/types";
import { SYSTEM_CERTIFICATE_TYPES } from "../../modules/certificate-types/types";
import { certificateTypeRepositoryContract, repositoryContract } from "../contract-tests/repositoryContract";
import { createSupabaseRepositories, SupabaseAuditRepository, SupabaseCertificateRepository, SupabaseDocRepository, SupabaseReminderLogRepository, SupabaseSettingsRepository } from "./createSupabaseRepositories";
import { createFakeSupabase } from "./fakeSupabase";

const settingsSeed = { settings: [{ id: "global", version: 0, doc: { reminderEmails: [], sendExpiredNotice: false, reminderDays: 30 } }] };
const typeSeed = { certificate_types: SYSTEM_CERTIFICATE_TYPES.map((type) => ({ id: type.id, version: type.version, key: type.key, doc: type })) };

repositoryContract(() => new SupabaseDocRepository(createFakeSupabase().client, "items"));
certificateTypeRepositoryContract(() => createSupabaseRepositories(createFakeSupabase(typeSeed).client).certificateTypes);

const certificate = (patch: Partial<Certificate> = {}): Certificate => ({ id: "c1", employeeId: "e1", type: "atld", title: "", number: "S-1", expiryDate: "2027-01-01", issueDate: null, document: { id: "f", name: "f.pdf", mime: "application/pdf", size: 1 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null, safetyGroup: 3, ...patch });

describe("Supabase repositories", () => {
  it("stores index columns next to the document and removes rows", async () => {
    const { client, tables } = createFakeSupabase();
    const repo = new SupabaseCertificateRepository(client);
    await repo.insert(certificate());
    expect(tables.certificates![0]).toMatchObject({ id: "c1", version: 1, employee_id: "e1", type: "atld", state: "current", expiry_date: "2027-01-01" });
    expect(await repo.get("missing")).toBeNull();
    const docs = new SupabaseDocRepository<{ id: string; version: number }>(client, "signatures");
    await docs.insert({ id: "s1", version: 1 });
    expect(await docs.remove("s1")).toBe(true);
    expect(await docs.remove("s1")).toBe(false);
  });

  it("renews atomically and refuses a stale version", async () => {
    const { client, tables } = createFakeSupabase();
    const repo = new SupabaseCertificateRepository(client);
    await repo.insert(certificate());
    const old = certificate({ state: "replaced", replacedBy: "c2", version: 2 });
    const next = certificate({ id: "c2", expiryDate: "2029-01-01" });
    expect(await repo.replaceAndInsert(old, next, 5)).toBe(false);
    expect(await repo.replaceAndInsert(old, next, 1)).toBe(true);
    expect(tables.certificates!.map((row) => [row.id, row.state, row.version])).toEqual([["c1", "replaced", 2], ["c2", "current", 1]]);
    expect((await repo.list()).map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  it("appends audit events, keeps settings versions and logs reminders", async () => {
    const { client } = createFakeSupabase(settingsSeed);
    const audit = new SupabaseAuditRepository(client);
    await audit.append({ id: "a2", at: "2026-10-15T02:00:00Z", actorId: "u1", role: "admin", action: "x", entityType: "employee", entityId: "e1", before: null, after: null });
    await audit.append({ id: "a1", at: "2026-10-15T01:00:00Z", actorId: "u1", role: "hr", action: "y", entityType: "employee", entityId: "e1", before: null, after: null });
    expect((await audit.list()).map((event) => event.id)).toEqual(["a1", "a2"]);

    const settings = new SupabaseSettingsRepository(client);
    expect(await settings.get()).toEqual({ reminderEmails: [], sendExpiredNotice: false, reminderDays: 30, version: 0 });
    expect(await settings.replace({ reminderEmails: ["hr@example.com"], sendExpiredNotice: true, reminderDays: 30, version: 1 }, 3)).toBe(false);
    expect(await settings.replace({ reminderEmails: ["hr@example.com"], sendExpiredNotice: true, reminderDays: 30, version: 1 }, 0)).toBe(true);
    expect(await settings.get()).toEqual({ reminderEmails: ["hr@example.com"], sendExpiredNotice: true, reminderDays: 30, version: 1 });

    const reminders = new SupabaseReminderLogRepository(client);
    await reminders.add({ identity: "c1|30|2027-01-01", certificateId: "c1", sentOn: "2026-12-02" });
    expect(await reminders.list()).toEqual([{ identity: "c1|30|2027-01-01", certificateId: "c1", sentOn: "2026-12-02" }]);
  });

  it("fills missing settings fields with safe defaults", async () => {
    const { client } = createFakeSupabase({ settings: [{ id: "global", version: 2, doc: {} }] });
    expect(await new SupabaseSettingsRepository(client).get()).toEqual({ reminderEmails: [], sendExpiredNotice: false, reminderDays: 30, version: 2 });
  });

  it("turns database errors into exceptions", async () => {
    const { client } = createFakeSupabase();
    await expect(new SupabaseDocRepository(client, "broken").list()).rejects.toThrow("Lỗi cơ sở dữ liệu: bảng hỏng");
    await expect(new SupabaseSettingsRepository(client).get()).rejects.toThrow("Lỗi cơ sở dữ liệu");
  });

  it("runs the HR use cases end to end on top of Supabase repositories", async () => {
    const { client, tables } = createFakeSupabase({ ...settingsSeed, ...typeSeed });
    const admin = { id: "admin-uuid", role: "admin" as const };
    const app = createHrApp({ clock: fixedClock("2026-10-15T09:00:00+07:00"), ids: sequentialIds("sb"), repositories: createSupabaseRepositories(client) });
    const created = await app.employees.create(admin, { code: "TNM100", name: "Trần Văn Kiểm Thử", dob: "1995-03-20", gender: "Nam", cccd: "001095123456", phone: "0912345678", home: "Thanh Hóa", address: "Lâm Đồng", position: "Nhân viên hiện trường", group: null, startDate: "2024-01-15", emergencyContactId: null, status: "active", endDate: null, photo: null });
    expect(created.ok).toBe(true);
    expect(tables.employees![0]).toMatchObject({ code: "TNM100", cccd: "001095123456" });
    const signature = await app.signatures.add(admin, { name: "Trần Đức Mạnh", role: "Giám đốc", file: { id: "sig", name: "sig.png", mime: "image/png", size: 10, hasTransparency: true } });
    expect(signature.ok && signature.value.isDefault).toBe(true);
    const saved = await app.settings.update(admin, { reminderEmails: ["HR@example.com"], sendExpiredNotice: false, expectedVersion: 0 });
    expect(saved.ok && saved.value.reminderEmails).toEqual(["hr@example.com"]);
    expect(tables.audit_events!.map((row) => row.action)).toEqual(["employee.create", "signature.add", "settings.update"]);
  });
});
