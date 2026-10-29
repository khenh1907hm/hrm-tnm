import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };
const hr = { id: "hr", role: "hr" as const };
const photo = { id: "img-1", name: "the.png", mime: "image/png", size: 100 };

describe("employee values for user-defined template fields", () => {
  it("stores, merges and clears values and images with optimistic locking and audit", async () => {
    const clock = fixedClock("2026-10-15T09:00:00+07:00");
    const app = createHrApp({ clock, ids: sequentialIds("extra"), repositories: await createDemoRepositories(clock, sequentialIds("seed-extra")) });
    const list = await app.employees.list(admin);
    const employee = list.ok ? list.value.items[0]! : null;
    if (!employee) throw new Error("no employee");

    expect((await app.employees.updateExtra(({ id: "outsider", role: "pending" } as never), { id: employee.id, expectedVersion: employee.version, fields: {}, files: {} })).ok).toBe(false);
    const first = await app.employees.updateExtra(admin, { id: employee.id, expectedVersion: employee.version, fields: { badgeNo: "TK-0099", note: "" }, files: { badgePhoto: photo } });
    expect(first.ok && first.value).toMatchObject({ extraFields: { badgeNo: "TK-0099" }, extraFiles: { badgePhoto: photo }, version: employee.version + 1 });
    if (!first.ok) return;
    expect(first.value.cccd).toContain("•");

    const second = await app.employees.updateExtra(admin, { id: employee.id, expectedVersion: first.value.version, fields: { badgeDate: "2026-09-01", badgeNo: "" }, files: { badgePhoto: null } });
    expect(second.ok && second.value.extraFields).toEqual({ badgeDate: "2026-09-01" });
    expect(second.ok && second.value.extraFiles).toEqual({});

    const stale = await app.employees.updateExtra(admin, { id: employee.id, expectedVersion: first.value.version, fields: {}, files: {} });
    expect(!stale.ok && stale.errors[0]?.code).toBe("CONFLICT");
    const invalid = await app.employees.updateExtra(admin, { id: employee.id, expectedVersion: employee.version + 2, fields: { "bad key": "x" }, files: {} });
    expect(!invalid.ok && invalid.errors[0]?.code).toBe("EMP_EXTRA_INVALID");
    const missing = await app.employees.updateExtra(admin, { id: "nope", expectedVersion: 1, fields: {}, files: {} });
    expect(!missing.ok && missing.errors[0]?.code).toBe("EMP_NOT_FOUND");
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.filter((event) => event.action === "employee.extra.update")).toHaveLength(2);
  });
});
