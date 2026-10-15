import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };
const pdf = { id: "f-health", name: "ksk.pdf", mime: "application/pdf", size: 100 };

async function setup() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const app = createHrApp({ clock, ids: sequentialIds("paging"), repositories: await createDemoRepositories(clock, sequentialIds("seed-paging")) });
  // TNM001 (Giám đốc) có thêm giấy khám sức khỏe → đủ chứng chỉ bắt buộc
  const listed = await app.employees.list(admin, { query: "TNM001" });
  if (!listed.ok) throw new Error("seed");
  expect(await app.certificates.add(admin, { employeeId: listed.value.items[0]!.id, type: "health", number: "KSK-01", issueDate: "2026-01-01", expiryDate: "2027-01-01", document: pdf, supplementaryFiles: [] })).toMatchObject({ ok: true });
  return app;
}
const codes = (result: { ok: boolean; value?: { items: { code: string }[] } }) => result.ok ? result.value!.items.map((item) => item.code) : [];

describe("employee list paging, multi-select filters and facets", () => {
  it("pages results and clamps the page number to the last page", async () => {
    const app = await setup();
    const second = await app.employees.list(admin, { page: 2, pageSize: 5 });
    expect(second.ok && { page: second.value.page, pageCount: second.value.pageCount, total: second.value.total }).toEqual({ page: 2, pageCount: 3, total: 12 });
    expect(codes(second)).toEqual(["TNM006", "TNM007", "TNM008", "TNM009", "TNM010"]);
    const beyond = await app.employees.list(admin, { page: 99, pageSize: 5 });
    expect(beyond.ok && beyond.value.page).toBe(3);
    expect(codes(beyond)).toEqual(["TNM011", "TNM012"]);
    const empty = await app.employees.list(admin, { query: "không ai cả" });
    expect(empty.ok && { page: empty.value.page, pageCount: empty.value.pageCount, total: empty.value.total }).toEqual({ page: 1, pageCount: 1, total: 0 });
  });

  it("combines values inside a group with OR and groups with AND", async () => {
    const app = await setup();
    expect(codes(await app.employees.list(admin, { certificateHealth: ["ok", "expired"] }))).toEqual(["TNM001", "TNM002"]);
    expect(codes(await app.employees.list(admin, { positions: ["Giám đốc"], certificateHealth: ["ok", "expired"] }))).toEqual(["TNM001"]);
    expect(codes(await app.employees.list(admin, { statuses: ["on_leave", "resigned"] }))).toEqual([]);
    expect(codes(await app.employees.list(admin, { statuses: ["active"], pageSize: 3 }))).toEqual(["TNM001", "TNM002", "TNM003"]);
  });

  it("matches certificate types with any-of or all-of", async () => {
    const app = await setup();
    const any = await app.employees.list(admin, { certificateTypes: ["atld", "health"] });
    expect(codes(any)).toEqual(["TNM001", "TNM003", "TNM004", "TNM005", "TNM006", "TNM007", "TNM008"]);
    expect(codes(await app.employees.list(admin, { certificateTypes: ["atld", "health"], certificateTypeMode: "all" }))).toEqual(["TNM001"]);
  });

  it("counts each option with the other groups applied", async () => {
    const app = await setup();
    const result = await app.employees.list(admin, { positions: ["Nhân viên hiện trường"], certificateHealth: ["missing"] });
    expect(result.ok && result.value.facets).toEqual({
      positions: { "Nhân viên hiện trường": 11 }, // TNM001 đã đủ chứng chỉ nên không lọt nhóm "thiếu"
      statuses: { active: 11 },
      certificateHealth: { ok: 0, missing: 11, expiring: 2, expired: 1 },
      certificateTypes: { atld: 6 },
    });
  });

  it("sorts by name or start date in either direction", async () => {
    const app = await setup();
    const byName = await app.employees.list(admin, { sort: "name", pageSize: 3 });
    expect(byName.ok && byName.value.items.map((item) => item.name)).toEqual(["Nguyễn Anh Sơn", "Nguyễn Bảo Long", "Nguyễn Gia Cường"]);
    expect(codes(await app.employees.list(admin, { sort: "code", sortDir: "desc", pageSize: 2 }))).toEqual(["TNM012", "TNM011"]);
    expect(codes(await app.employees.list(admin, { sort: "startDate", pageSize: 2 }))).toEqual(["TNM001", "TNM002"]);
  });
});
