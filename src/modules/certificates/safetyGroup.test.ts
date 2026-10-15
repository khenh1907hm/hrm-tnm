import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { buildSystemValues } from "../excel-template/engine/fieldValues";
import { certificateTitleFor, currentSafetyGroup, currentSafetyGroups, formatSafetyGroups, isValidSafetyGroup, normalizeSafetyGroup, SAFETY_GROUPS } from "./safetyGroup";
import type { Certificate } from "./types";

const admin = { id: "admin", role: "admin" as const };
const pdf = { id: "doc", name: "the.pdf", mime: "application/pdf", size: 1024 };
const certificate = (patch: Partial<Certificate>): Certificate => ({ id: "c", employeeId: "e1", type: "atld", title: "", number: "S-1", expiryDate: "2027-01-01", issueDate: null, document: pdf, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null, ...patch });

async function setup() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const repositories = await createDemoRepositories(clock, sequentialIds("seed-safety"));
  const app = createHrApp({ clock, ids: sequentialIds("safety"), repositories });
  const list = await app.employees.list(admin);
  if (!list.ok) throw new Error("no employees");
  // Nhân sự thứ 10 chưa có chứng chỉ ATLĐ mẫu
  return { app, employee: list.value.items[9]! };
}

describe("safety group helpers", () => {
  it("lists the six training groups and validates them", () => {
    expect(SAFETY_GROUPS.map((item) => item.group)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(isValidSafetyGroup(3)).toBe(true);
    expect(isValidSafetyGroup(0)).toBe(false);
    expect(isValidSafetyGroup(2.5)).toBe(false);
    expect(normalizeSafetyGroup("atld", 4)).toBe(4);
    expect(normalizeSafetyGroup("atld", 9)).toBeNull();
    expect(normalizeSafetyGroup("health", 3)).toBeNull();
    expect(normalizeSafetyGroup("atld", undefined)).toBeNull();
  });

  it("prefers the group of the current safety certificate, falling back to the employee record", () => {
    const employee = { id: "e1", group: 4 };
    expect(currentSafetyGroup(employee, [])).toBe(4);
    expect(currentSafetyGroup(employee, [certificate({ safetyGroup: 3 }), certificate({ id: "c2", safetyGroup: 1, expiryDate: "2028-01-01" })])).toBe(1);
    expect(currentSafetyGroup(employee, [certificate({ safetyGroup: 3, state: "replaced" }), certificate({ id: "x", employeeId: "e2", safetyGroup: 2 })])).toBe(4);
    expect(currentSafetyGroup({ id: "e1", group: null }, [certificate({ safetyGroup: null })])).toBeNull();
  });
});

describe("safety certificate use cases", () => {
  it("stores the group on add, keeps it on renew unless changed, and ignores it for other types", async () => {
    const { app, employee } = await setup();
    const added = await app.certificates.add(admin, { employeeId: employee.id, type: "atld", number: "ATLD-N3-01", issueDate: "2025-11-01", expiryDate: "2027-11-01", document: pdf, safetyGroup: 3 });
    expect(added.ok && added.value.safetyGroup).toBe(3);
    if (!added.ok) return;

    const renewed = await app.certificates.renew(admin, { id: added.value.id, expectedVersion: added.value.version, type: "atld", number: "ATLD-N3-02", issueDate: "2026-10-01", expiryDate: "2028-10-01", document: pdf });
    expect(renewed.ok && renewed.value.safetyGroup).toBe(3);
    if (!renewed.ok) return;
    const promoted = await app.certificates.update(admin, { id: renewed.value.id, expectedVersion: renewed.value.version, type: "atld", number: "ATLD-N3-02", issueDate: "2026-10-01", expiryDate: "2028-10-01", document: pdf, safetyGroup: 2 });
    expect(promoted.ok && promoted.value.safetyGroup).toBe(2);

    const health = await app.certificates.add(admin, { employeeId: employee.id, type: "health", number: "KSK-01", issueDate: "2026-06-01", expiryDate: "2027-06-01", document: pdf, safetyGroup: 3 });
    expect(health.ok && health.value.safetyGroup).toBeNull();
  });

  it("rejects an out-of-range group for the safety certificate", async () => {
    const { app, employee } = await setup();
    const result = await app.certificates.add(admin, { employeeId: employee.id, type: "atld", number: "ATLD-BAD", issueDate: "2025-11-01", expiryDate: "2027-11-01", document: pdf, safetyGroup: 7 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((item) => item.code)).toContain("CERT_SAFETY_GROUP_INVALID");
  });

  it("shows the certificate group on the profile template values", () => {
    const values = buildSystemValues({
      employee: { id: "e1", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088000001", phone: "0830000001", home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2020-01-15", emergencyContactId: null, status: "active", endDate: null, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, version: 1 },
      commander: null, certificates: [certificate({ safetyGroup: 3 })], certificateTypes: ["atld"], exportDate: "2026-10-14",
    });
    expect(values.safetyGroup).toBe("Nhóm 3");
  });
});

describe("several safety groups per employee", () => {
  it("names each safety certificate after its group and lists the groups in order", () => {
    expect(certificateTitleFor("atld", "", 3)).toBe("Nhóm 3");
    expect(certificateTitleFor("atld", "Thẻ công trường", 3)).toBe("Thẻ công trường");
    expect(certificateTitleFor("health", "", 3)).toBe("");
    expect(certificateTitleFor("atld", undefined, null)).toBe("");
    const employee = { id: "e1", group: null };
    const list = [certificate({ id: "a", safetyGroup: 3 }), certificate({ id: "b", safetyGroup: 1, expiryDate: "2026-01-01" }), certificate({ id: "c", safetyGroup: 3 })];
    expect(currentSafetyGroups(employee, list)).toEqual([1, 3]);
    expect(currentSafetyGroups(employee, list, "2026-06-01")).toEqual([3]);
    expect(currentSafetyGroups({ id: "e1", group: 4 }, [])).toEqual([4]);
    expect(currentSafetyGroups(employee, [])).toEqual([]);
    expect(formatSafetyGroups([1, 3])).toBe("Nhóm 1, 3");
    expect(formatSafetyGroups([])).toBe("");
  });

  it("lets one employee hold group 1 and group 3 but not the same group twice", async () => {
    const { app, employee } = await setup();
    const group1 = await app.certificates.add(admin, { employeeId: employee.id, type: "atld", number: "ATLD-N1-01", issueDate: "2025-11-01", expiryDate: "2027-11-01", document: pdf, safetyGroup: 1 });
    const group3 = await app.certificates.add(admin, { employeeId: employee.id, type: "atld", number: "ATLD-N3-01", issueDate: "2025-11-01", expiryDate: "2027-11-01", document: pdf, safetyGroup: 3 });
    expect(group1.ok && group1.value.title).toBe("Nhóm 1");
    expect(group3.ok && group3.value.title).toBe("Nhóm 3");
    const duplicate = await app.certificates.add(admin, { employeeId: employee.id, type: "atld", number: "ATLD-N3-02", issueDate: "2025-11-01", expiryDate: "2027-11-01", document: pdf, safetyGroup: 3 });
    expect(!duplicate.ok && duplicate.errors.map((item) => item.code)).toContain("CERT_ALREADY_EXISTS");
    const checklist = await app.certificates.checklist(admin, employee.id);
    expect(checklist.ok && checklist.value.rows.filter((row) => row.type === "atld").map((row) => row.displayName)).toEqual(["An toàn lao động (Nhóm 1)", "An toàn lao động (Nhóm 3)"]);
  });
});
