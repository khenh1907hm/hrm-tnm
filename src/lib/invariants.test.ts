import { describe, expect, it } from "vitest";
import { array, assert, asyncProperty, boolean, integer, property, string } from "fast-check";
import { normalizePhone } from "./vietnam/phone";
import { decodeCccd } from "./vietnam/cccd";
import { createHrApp } from "../app-core/createHrApp";
import { fixedClock } from "./clock";
import { sequentialIds } from "./ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";

describe("property invariants", () => {
  it("INV_07 keeps phone normalization idempotent for arbitrary text", () => {
    expect(assert(property(string(), (input) => {
      const normalized = normalizePhone(input);
      return normalizePhone(normalized) === normalized;
    }), { numRuns: 500 })).toBeUndefined();
  });

  it("INV_07 decodes generated gender and birth year from a structurally valid CCCD", () => {
    expect(assert(property(integer({ min: 0, max: 99 }), boolean(), integer({ min: 0, max: 999999 }), (year, female, suffix) => {
      const centuryDigit = female ? "3" : "2";
      const value = `079${centuryDigit}${String(year).padStart(2, "0")}${String(suffix).padStart(6, "0")}`;
      const decoded = decodeCccd(value);
      return decoded?.gender === (female ? "Nữ" : "Nam") && decoded.birthYear === 2000 + year;
    }), { numRuns: 300 })).toBeUndefined();
  });

  it("INV_04 INV_05 preserves visibility and audit consistency through archive transitions", async () => {
    expect(await assert(asyncProperty(array(boolean(), { minLength: 1, maxLength: 12 }), async (archiveSequence) => {
      const clock = fixedClock("2026-10-12T09:00:00+07:00");
      const repositories = await createDemoRepositories(clock, sequentialIds("property-seed"));
      const app = createHrApp({ clock, ids: sequentialIds("property-app"), repositories });
      const actor = { id: "property-admin", role: "admin" as const };
      const initial = await app.employees.list(actor);
      const employee = initial.ok ? initial.value.items[0] : undefined;
      if (!employee) return false;
      let version = employee.version;
      let archived = false;
      let successfulChanges = 0;
      for (const shouldArchive of archiveSequence) {
        if (shouldArchive === archived) continue;
        const result = shouldArchive
          ? await app.employees.archive(actor, { id: employee.id, expectedVersion: version, reason: "property transition" })
          : await app.employees.restore(actor, { id: employee.id, expectedVersion: version });
        if (!result.ok) return false;
        version = result.value.version;
        archived = shouldArchive;
        successfulChanges += 1;
        const visible = await app.employees.list(actor);
        const audit = await app.audit.list(actor);
        if (!visible.ok || !audit.ok || visible.value.items.some((item) => item.id === employee.id) === archived) return false;
        if (audit.value.length !== successfulChanges) return false;
      }
      return true;
    }), { numRuns: 20 })).toBeUndefined();
  });

  it("INV_01 allows multiple current titles per type but rejects normalized duplicate pairs", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("inv01-seed"));
    const app = createHrApp({ clock, ids: sequentialIds("inv01-app"), repositories });
    const admin = { id: "inv01-admin", role: "admin" as const };
    const employees = await app.employees.list(admin);
    expect(employees.ok).toBe(true);
    if (!employees.ok) throw new Error("employee fixture missing");
    const employee = employees.value.items[0];
    expect(employee).toBeDefined();
    if (!employee) throw new Error("employee fixture missing");
    const certificateInput = (number: string, title: string) => ({
      employeeId: employee.id, type: "atld", title, number, issueDate: null, expiryDate: "2027-01-01",
      document: { id: `file-${number}`, name: "certificate.pdf", mime: "application/pdf", size: 128 }, supplementaryFiles: [],
    });
    expect((await app.certificates.add(admin, certificateInput("INV01-001", "Alpha"))).ok).toBe(true);
    expect((await app.certificates.add(admin, certificateInput("INV01-002", "Beta"))).ok).toBe(true);
    expect(await app.certificates.add(admin, certificateInput("INV01-003", "  ALPHA "))).toMatchObject({
      ok: false, errors: [{ code: "CERT_ALREADY_EXISTS", field: "title" }],
    });
    const current = await app.certificates.listByEmployee(admin, employee.id);
    expect(current.ok && current.value.filter((item) => item.state === "current" && item.type === "atld").map((item) => item.title)).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
  });
});
