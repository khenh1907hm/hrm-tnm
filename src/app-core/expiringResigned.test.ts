import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };

describe("expiring certificate list", () => {
  it("leaves out employees who have resigned, like the email reminders do", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("seed-resigned"));
    const app = createHrApp({ clock, ids: sequentialIds("resigned"), repositories });
    const before = await app.employees.list(admin, { query: "TNM002" });
    if (!before.ok) throw new Error("seed");
    const worker = (await repositories.employees.get(before.value.items[0]!.id))!;
    const listed = async () => { const result = await app.certificates.listExpiring(admin); return result.ok ? result.value.map((item) => item.employeeCode) : []; };
    expect(await listed()).toContain("TNM002");

    await repositories.employees.replace({ ...worker, status: "resigned", endDate: "2026-10-01", version: worker.version + 1 }, worker.version);
    expect(await listed()).not.toContain("TNM002");
    const due = await app.reminders.computeDue(admin);
    expect(due.ok && due.value.map((item) => item.employee.code)).not.toContain("TNM002");
  });
});
