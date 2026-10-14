import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import type { Certificate } from "./types";
import type { Employee } from "../employees/types";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";
import { createHrApp } from "../../app-core/createHrApp";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { getCertificateChecklist } from "./checklist";

const employee: Employee = {
  id: "list-worker", code: "TNM900", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh giả", address: "Địa chỉ giả", position: "Nhân viên hiện trường", group: 1, startDate: "2020-01-15", emergencyContactId: "cmd-1",
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
};
const file = (id: string) => ({ id, name: `${id}.pdf`, mime: "application/pdf", size: 100 });
const cert = (id: string, type: string, title: string, expiryDate: string, extras: Partial<Certificate> = {}): Certificate => ({
  id, employeeId: employee.id, type, title, number: `CERT-${id}`, issueDate: null, expiryDate, document: file(`doc-${id}`), supplementaryFiles: [],
  state: "current", version: 1, replacedBy: null, archiveReason: null, ...extras,
});
const admin = { id: "list-admin", role: "admin" as const };

async function searchFixture() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const repositories = await createDemoRepositories(clock, sequentialIds("list-search-seed"));
  const app = createHrApp({ clock, ids: sequentialIds("list-search-app"), repositories });
  const listed = await app.employees.list(admin);
  if (!listed.ok) throw new Error("missing employee fixtures");
  return { app, repositories, employees: listed.value.items };
}

describe("certificate checklist LIST rules", () => {
  it("LIST_01 emits missing and not-required rows for every active category without certificates", () => {
    const { rows, summary } = getCertificateChecklist(employee, SYSTEM_CERTIFICATE_TYPES, [], "2026-10-12");
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.status)).toEqual(["missing", "missing", "missing", "missing", "not_required", "not_required", "not_required"]);
    expect(summary).toEqual({ missing: 4, expiring: 0, expired: 0 });
  });

  it("LIST_01 emits one row per current certificate and orders rows by category then title", () => {
    const types = [...SYSTEM_CERTIFICATE_TYPES].reverse();
    const certificates = [cert("taikisha", "atld", "Taikisha", "2027-03-01"), cert("unnamed", "atld", "", "2027-03-01")];
    const { rows } = getCertificateChecklist(employee, types, certificates, "2026-10-12");
    expect(rows.filter((row) => row.type === "atld").map((row) => row.displayName)).toEqual(["An toàn lao động", "An toàn lao động (Taikisha)"]);
    expect(rows.map((row) => row.type)).toEqual(["atld", "atld", "health", "ins", "elec", "weld", "crane", "fork"]);
  });

  it("LIST_02 returns localized display, expiry days, state, primary flag, and supplement count", () => {
    const certificate = cert("expiring", "atld", "Taikisha", "2026-11-11", {
      document: file("primary"), supplementaryFiles: [{ file: file("supp-a"), label: "Giấy bổ sung A" }, { file: file("supp-b"), label: null }],
    });
    const { rows } = getCertificateChecklist(employee, SYSTEM_CERTIFICATE_TYPES, [certificate], "2026-10-12");
    expect(rows[0]).toEqual(expect.objectContaining({
      displayName: "An toàn lao động (Taikisha)", number: "CERT-expiring", expiryDate: "2026-11-11", daysLeft: 30,
      status: "expiring", hasPrimaryFile: true, supplementaryFileCount: 2,
    }));
  });

  it("LIST_03 summary counts missing, expiring, and expired separately", () => {
    const certificates = [cert("expired", "atld", "", "2026-10-11"), cert("soon", "health", "Taikisha", "2026-10-20")];
    const { summary } = getCertificateChecklist(employee, SYSTEM_CERTIFICATE_TYPES, certificates, "2026-10-12");
    expect(summary).toEqual({ missing: 2, expiring: 1, expired: 1 });
  });

  it("LIST_01 excludes hidden categories, archived certificates, and replaced certificates", () => {
    const hiddenType: CertificateTypeRecord = { ...SYSTEM_CERTIFICATE_TYPES[6]!, id: "hidden-type", key: "custom-hidden", system: false, archived: true };
    const types = [...SYSTEM_CERTIFICATE_TYPES, hiddenType];
    const certificates = [
      cert("archived", "atld", "Archived", "2027-01-01", { state: "archived" }),
      cert("replaced", "health", "Replaced", "2027-01-01", { state: "replaced", replacedBy: "new-cert" }),
      cert("hidden-type", hiddenType.key, "Hidden type", "2027-01-01"),
    ];
    const { rows } = getCertificateChecklist(employee, types, certificates, "2026-10-12");
    expect(rows.some((row) => row.title === "Archived" || row.title === "Replaced" || row.title === "Hidden type")).toBe(false);
    expect(rows.map((row) => row.displayName)).not.toContain(hiddenType.key);
    expect(rows).toHaveLength(SYSTEM_CERTIFICATE_TYPES.length);
    expect(rows.map((row) => row.displayName)).toEqual(SYSTEM_CERTIFICATE_TYPES.map((type) => type.name));
  });

  it("LIST_01 orders categories by sortOrder and titles by normalized name with complete Vietnamese labels", () => {
    const { rows } = getCertificateChecklist(employee, [...SYSTEM_CERTIFICATE_TYPES].reverse(), [
      cert("title-z", "atld", "Đào tạo", "2027-01-01"),
      cert("title-a", "atld", "An toàn", "2027-01-01"),
    ], "2026-10-12");
    expect(rows.slice(0, 2).map((row) => row.title)).toEqual(["An toàn", "Đào tạo"]);
    const visible = rows.flatMap((row) => [row.displayName, row.statusLabel]).join(" ").toLocaleLowerCase("vi");
    expect(visible).not.toMatch(/\b(atld|health|elec|ins|weld|crane|fork)\b/);
  });

  it("LIST_01 uses normalized code-point order for tied category and title sorts", () => {
    const tiedTypes: CertificateTypeRecord[] = [
      { ...SYSTEM_CERTIFICATE_TYPES[0]!, id: "z-type", key: "z-type", name: "Hòa Phát", sortOrder: 1 },
      { ...SYSTEM_CERTIFICATE_TYPES[1]!, id: "a-type", key: "a-type", name: "Hoa Phat", sortOrder: 1 },
    ];
    const { rows } = getCertificateChecklist(employee, tiedTypes, [
      cert("z-title", "a-type", "Hòa Phát", "2027-01-01"), cert("a-title", "a-type", "Hoa Phat", "2027-01-01"),
    ], "2026-10-12");
    expect(rows.map((row) => row.type)).toEqual(["a-type", "a-type", "z-type"]);
    expect(rows.slice(0, 2).map((row) => row.title)).toEqual(["Hoa Phat", "Hòa Phát"]);
  });

  it("LIST_02 renders unnamed certificates as the plain Vietnamese category name", () => {
    const { rows } = getCertificateChecklist(employee, SYSTEM_CERTIFICATE_TYPES, [cert("blank-title", "elec", "", "2027-01-01")], "2026-10-12");
    expect(rows.find((row) => row.type === "elec")).toMatchObject({ displayName: "An toàn điện", title: "" });
  });

  it("LIST_03 does not count an expired current certificate as missing", () => {
    const { rows, summary } = getCertificateChecklist(employee, SYSTEM_CERTIFICATE_TYPES, [cert("expired-atld", "atld", "", "2026-10-11")], "2026-10-12");
    expect(rows.find((row) => row.type === "atld")?.status).toBe("expired");
    expect(summary.missing).toBe(3);
    expect(summary.expired).toBe(1);
  });

  it("LIST_01 checks required defaults across all seven categories and five positions", () => {
    const positions = ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
    expect(SYSTEM_CERTIFICATE_TYPES.map((type) => positions.map((position) => type.requiredForPositions.includes(position)))).toEqual([
      [true, true, true, true, true], [true, true, true, true, true], [false, false, true, true, true], [false, false, true, true, true],
      [false, false, false, false, false], [false, false, false, false, false], [false, false, false, false, false],
    ]);
  });

  it("SRCH_03 combines missing-required with expired and expiring filters", async () => {
    const { app, employees } = await searchFixture();
    const expiredAndMissing = await app.employees.search(admin, { missingRequiredCertificate: true, expiredCertificates: true });
    expect(expiredAndMissing.ok && expiredAndMissing.value.items.map((item) => item.code)).toContain("TNM002");
    expect(expiredAndMissing.ok && expiredAndMissing.value.items.every((item) => item.code === "TNM002")).toBe(true);
    const expiringAndMissing = await app.employees.search(admin, { missingRequiredCertificate: true, expiringCertificates: true });
    expect(expiringAndMissing.ok && expiringAndMissing.value.items.map((item) => item.code)).toEqual(["TNM003", "TNM004"]);
    const archivedEmployee = employees.find((item) => item.code === "TNM002");
    expect(archivedEmployee).toBeDefined();
    if (!archivedEmployee) throw new Error("employee fixture missing");
    expect(await app.employees.archive(admin, { id: archivedEmployee.id, expectedVersion: archivedEmployee.version, reason: "Ẩn để kiểm thử" })).toMatchObject({ ok: true });
    const defaultArchiveSearch = await app.employees.search(admin, { missingRequiredCertificate: true, expiredCertificates: true });
    expect(defaultArchiveSearch.ok && defaultArchiveSearch.value.items.map((item) => item.code)).not.toContain("TNM002");
    const explicitArchiveSearch = await app.employees.search(admin, { includeArchived: true, missingRequiredCertificate: true, expiredCertificates: true });
    expect(explicitArchiveSearch.ok && explicitArchiveSearch.value.items.map((item) => item.code)).toContain("TNM002");
  });
});
