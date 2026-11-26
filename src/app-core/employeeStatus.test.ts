import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };

describe("employee active / inactive switch", () => {
  it("changes only the status, even when other fields would fail full validation", async () => {
    const clock = fixedClock("2026-10-15T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("seed-status"));
    const app = createHrApp({ clock, ids: sequentialIds("status"), repositories });
    const list = await app.employees.list(admin);
    const employee = list.ok ? list.value.items[0]! : null;
    if (!employee) throw new Error("no employee");
    // Hồ sơ thiếu số điện thoại vẫn gạt được
    const stored = (await repositories.employees.get(employee.id))!;
    await repositories.employees.replace({ ...stored, phone: "", version: stored.version + 1 }, stored.version);

    expect((await app.employees.setStatus(({ id: "outsider", role: "pending" } as never), { id: employee.id, expectedVersion: stored.version + 1, status: "inactive" })).ok).toBe(false);
    const off = await app.employees.setStatus(admin, { id: employee.id, expectedVersion: stored.version + 1, status: "inactive" });
    expect(off.ok && off.value).toMatchObject({ status: "inactive", phone: "", version: stored.version + 2 });
    if (!off.ok) return;
    expect(off.value.cccd).toContain("•");
    const stale = await app.employees.setStatus(admin, { id: employee.id, expectedVersion: stored.version + 1, status: "active" });
    expect(!stale.ok && stale.errors[0]?.code).toBe("CONFLICT");
    const on = await app.employees.setStatus(admin, { id: employee.id, expectedVersion: off.value.version, status: "active" });
    expect(on.ok && on.value.status).toBe("active");
  });
});
