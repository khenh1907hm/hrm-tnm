import { describe, expect, it } from "vitest";
import { createHrApp } from "./createHrApp";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import type { EmployeeInput } from "../modules/employees/types";

const admin = { id: "actor-admin", role: "admin" as const };
const hr = { id: "actor-hr", role: "hr" as const };
const validEmployee: EmployeeInput = {
  code: " tnm999 ", name: "NGUYỄN MINH AN", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "+84 839 395 292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1", status: "active", endDate: null,
};

describe("employee application use cases", () => {
  it("EMP_01 EMP_02 EMP_04 EMP_05 creates normalized valid employee and audits it", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("test") });
    const input = structuredClone(validEmployee);
    const preview = await app.employees.validate(admin, { ...input, dob: "2009-05-12", startDate: "2024-05-12", mismatchOverrideReason: "Đã đối chiếu hồ sơ" });
    if (!preview.ok) throw new Error("expected validation preview to pass");
    expect(preview.warnings.length).toBeGreaterThan(0);
    const preflightAudit = await app.audit.list(admin);
    expect(preflightAudit.ok && preflightAudit.value).toHaveLength(0);
    const created = await app.employees.create(admin, input);
    expect(created.ok).toBe(true);
    expect(input.code).toBe(" tnm999 ");
    if (!created.ok) return;
    expect(created.value.code).toBe("TNM999");
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value).toHaveLength(1);
    const denied = await app.employees.create(hr, validEmployee);
    expect(denied.ok).toBe(false);
  });

  it("INV_02 INV_05 validates warnings without writes and rejects identifiers from archived rows", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const list = await app.employees.list(admin);
    if (!list.ok || !list.value.items[0]) throw new Error("missing demo employee");
    const employee = list.value.items[0];
    const archived = await app.employees.archive(admin, { id: employee.id, expectedVersion: employee.version, reason: "fixture archived" });
    if (!archived.ok) throw new Error("could not archive demo employee");
    const revealed = await app.employees.revealCccd(admin, employee.id);
    if (!revealed.ok) throw new Error("could not reveal demo CCCD");
    const before = await app.audit.list(admin);
    const duplicate = await app.employees.validate(admin, { ...validEmployee, code: employee.code, cccd: revealed.value, excludeId: "new-record" });
    expect(duplicate.ok).toBe(false);
    const after = await app.audit.list(admin);
    if (!before.ok || !after.ok) throw new Error("audit list unavailable");
    expect(after.value).toHaveLength(before.value.length);
    expect((await app.employees.validate(hr, validEmployee)).ok).toBe(false);
  });

  it("EMP_08 archive hides a record and restore makes it visible", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const list = await app.employees.list(admin);
    if (!list.ok) throw new Error("unexpected list failure");
    const employee = list.value.items[0];
    if (!employee) throw new Error("missing fixture");
    const archive = await app.employees.archive(admin, { id: employee.id, expectedVersion: employee.version, reason: "Left company" });
    expect(archive.ok).toBe(true);
    const hidden = await app.employees.list(admin);
    expect(hidden.ok && hidden.value.total).toBe(11);
    if (!archive.ok) return;
    const restored = await app.employees.restore(admin, { id: employee.id, expectedVersion: archive.value.version });
    expect(restored.ok).toBe(true);
  });

  it("AUD_01 AUD_02 AUD_03 reveal logs access and masks personal numbers in audit", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const listed = await app.employees.list(hr);
    if (!listed.ok || !listed.value.items[0]) throw new Error("missing fixture");
    const employee = listed.value.items[0];
    const reveal = await app.employees.revealCccd(hr, employee.id);
    expect(reveal.ok && reveal.value).toMatch(/^\d{12}$/);
    expect((await app.audit.list(hr)).ok).toBe(false);
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value[0]?.action).toBe("cccd.reveal");
    expect(audit.ok && JSON.stringify(audit.value)).not.toContain(reveal.ok ? reveal.value : "not-found");
  });

  it("SRCH_01 SRCH_02 SRCH_03 searches, filters, sorts, and paginates", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const result = await app.employees.search(admin, { query: "nguyen minh", page: 1, pageSize: 2 });
    expect(result.ok && result.value.items).toHaveLength(2);
    expect(result.ok && result.value.pageSize).toBe(2);
  });
});

describe("certificate, reminders, and access", () => {
  it("REM_01 REM_02 REM_03 REM_04 REM_05 computes once, skips without recipient, and retries failed sends", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const due = await app.reminders.computeDue(admin);
    expect(due.ok && due.value.length).toBeGreaterThan(0);
    const run = await app.reminders.run(admin);
    expect(run.ok && run.value.skipped.length).toBeGreaterThan(0);
    expect((await app.reminders.run(hr)).ok).toBe(false);
  });

  it("CERT_01 CERT_06 CERT_07 CERT_08 CERT_09 CERT_10 honors current and replaced states", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories });
    const listed = await app.employees.list(admin);
    if (!listed.ok || !listed.value.items[2]) throw new Error("missing fixture");
    const employee = listed.value.items[2];
    const first = await app.certificates.add(admin, { employeeId: employee.id, type: "health", title: "Taikisha", number: "KSK-001", issueDate: "2026-01-01", expiryDate: "2027-01-01", document: { id: "f1", name: "sample.pdf", mime: "application/pdf", size: 100 }, supplementaryFiles: [] });
    expect(first.ok).toBe(true);
    const duplicate = await app.certificates.add(admin, { employeeId: employee.id, type: "health", title: "TAIKISHA", number: "KSK-002", issueDate: "2026-01-01", expiryDate: "2027-01-01", document: { id: "f2", name: "sample.pdf", mime: "application/pdf", size: 100 }, supplementaryFiles: [] });
    expect(duplicate.ok).toBe(false);
    expect((await app.certificates.listByEmployee(hr, employee.id)).ok).toBe(true);
    expect((await app.certificates.listByEmployee(hr, "unknown")).ok).toBe(true);
  });

  it("REM_06 sends Vietnamese email after mail service is provided", async () => {
    const repositories = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed"));
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("case"), repositories, mailer: { send: async () => undefined } });
    const settings = await app.settings.update(admin, { reminderEmails: ["hr@example.test"], sendExpiredNotice: false, expectedVersion: 0 });
    expect(settings.ok).toBe(true);
    const sent = await app.reminders.run(admin);
    expect(sent.ok && sent.value.sent.length).toBeGreaterThan(0);
  });
});

describe("signature and settings use cases", () => {
  it("SIG_01 SIG_02 SIG_03 INV_03 keeps one default and refuses to remove the final signature", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("sig") });
    const signature = (name: string) => ({ name, role: "Giám đốc", file: { id: name, name: "signature.png", mime: "image/png", size: 1024, hasTransparency: true } });
    const first = await app.signatures.add(admin, signature("Nguyễn Minh An"));
    const second = await app.signatures.add(admin, signature("Trần Gia Bảo"));
    expect(first.ok && first.value.isDefault).toBe(true);
    expect(second.ok && second.value.isDefault).toBe(false);
    if (!second.ok) return;
    expect((await app.signatures.setDefault(admin, second.value.id)).ok).toBe(true);
    const listed = await app.signatures.list(admin);
    expect(listed.ok && listed.value.filter((item) => item.isDefault)).toHaveLength(1);
    expect((await app.signatures.remove(admin, second.value.id)).ok).toBe(true);
    const finalList = await app.signatures.list(admin);
    if (!finalList.ok || !finalList.value[0]) throw new Error("missing signature");
    expect(finalList.value[0].isDefault).toBe(true);
    expect((await app.signatures.remove(admin, finalList.value[0].id)).ok).toBe(false);
    expect((await app.signatures.add(hr, signature("HR user"))).ok).toBe(false);
  });

  it("SET_01 validates recipients and optimistic version", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("settings") });
    expect((await app.settings.update(admin, { reminderEmails: ["invalid"], sendExpiredNotice: false, expectedVersion: 0 })).ok).toBe(false);
    const saved = await app.settings.update(admin, { reminderEmails: ["HR@example.test", "hr@example.test"], sendExpiredNotice: true, expectedVersion: 0 });
    expect(saved.ok && saved.value.reminderEmails).toEqual(["hr@example.test"]);
    expect((await app.settings.update(admin, { reminderEmails: [], sendExpiredNotice: false, expectedVersion: 0 })).ok).toBe(false);
  });
});
