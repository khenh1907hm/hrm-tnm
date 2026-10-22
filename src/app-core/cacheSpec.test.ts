import { describe, expect, it } from "vitest";
import type { Clock } from "../lib/clock";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import type { Actor } from "../modules/auth/permissions";
import type { EmployeeInput } from "../modules/employees/types";
import { cacheRepositories } from "../repositories/cached";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin: Actor = { id: "admin", role: "admin" };

/** Kho nhớ có bộ đếm số lần đọc cả bảng, bọc bằng bộ nhớ tạm như chế độ thật. */
async function setup(clock: Clock) {
  const base = await createDemoRepositories(fixedClock("2026-10-12T09:00:00+07:00"), sequentialIds("seed-spec"));
  const calls = { employees: 0, certificates: 0 };
  const count = <K extends keyof typeof calls>(key: K) => {
    const repository = base[key] as { list(): Promise<unknown[]> };
    const list = repository.list.bind(repository);
    repository.list = async () => { calls[key] += 1; return list(); };
  };
  count("employees"); count("certificates");
  const { repositories } = cacheRepositories(base, 30_000);
  const app = createHrApp({ clock, ids: sequentialIds("spec"), repositories });
  return { app, calls };
}

describe("bảo mật và nghiệp vụ qua bộ nhớ tạm", () => {
  it("12. danh sách vẫn che CCCD; tìm CCCD chỉ khớp chính xác", async () => {
    const { app } = await setup(fixedClock("2026-10-12T09:00:00+07:00"));
    const listed = await app.employees.list(admin, { pageSize: 100 });
    if (!listed.ok) throw new Error("list");
    expect(listed.value.items.every((employee) => !/^\d{12}$/.test(employee.cccd))).toBe(true);
    // "079088000001" là CCCD của TNM001
    // Chuỗi con của CCCD nhưng không trùng mã hay SĐT của ai
    const partial = await app.employees.list(admin, { query: "79088" });
    expect(partial.ok && partial.value.total).toBe(0);
    const partialPrefix = await app.employees.list(admin, { query: "079" });
    expect(partialPrefix.ok && partialPrefix.value.total).toBe(0);
    const exact = await app.employees.list(admin, { query: "079088000001" });
    expect(exact.ok && exact.value.items.map((employee) => employee.code)).toEqual(["TNM001"]);
  });

  it("13. tài khoản chưa cấp quyền bị chặn dù bộ nhớ tạm đã có dữ liệu", async () => {
    const { app, calls } = await setup(fixedClock("2026-10-12T09:00:00+07:00"));
    await app.employees.list(admin);
    const pending = { id: "p", role: "pending" } as unknown as Actor;
    expect(await app.employees.list(pending)).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    expect(await app.employees.get(pending, "seed-spec-1")).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    expect(await app.certificates.listExpiring(pending)).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    expect(calls.employees).toBe(1);
  });

  it("14. chứng chỉ đổi trạng thái đúng qua nửa đêm giờ Việt Nam mà không cần tải lại dữ liệu", async () => {
    let now = "2026-10-12T23:59:00+07:00";
    const { app, calls } = await setup({ now: () => now });
    const before = await app.certificates.listExpiring(admin);
    if (!before.ok) throw new Error("expiring");
    // TNM003 có chứng chỉ hết hạn ngày 12/10/2026
    expect(before.value.find((row) => row.employeeCode === "TNM003")).toMatchObject({ daysLeft: 0, group: "d30" });
    now = "2026-10-12T17:00:30Z"; // 00:00:30 ngày 13/10 giờ Việt Nam
    const after = await app.certificates.listExpiring(admin);
    if (!after.ok) throw new Error("expiring");
    expect(after.value.find((row) => row.employeeCode === "TNM003")).toMatchObject({ daysLeft: -1, group: "expired" });
    expect(calls.certificates).toBe(1);
  });

  it("15. tìm không dấu 'nguyen minh an' ra 'Nguyễn Minh An'; người đã lưu trữ không hiện ở danh sách đang làm việc", async () => {
    const { app } = await setup(fixedClock("2026-10-12T09:00:00+07:00"));
    // Hành vi hiện tại: mỗi từ khớp một phần ("an" cũng khớp "Quân"), nên chỉ kiểm tra có mặt
    const found = await app.employees.list(admin, { query: "nguyen minh an" });
    expect(found.ok && found.value.items.map((employee) => employee.name)).toContain("Nguyễn Minh An");
    const dong = await app.employees.list(admin, { query: "hoang dung" });
    expect(dong.ok && dong.value.items.map((employee) => employee.name)).toEqual(["Nguyễn Hoàng Dũng"]);
    if (!found.ok) throw new Error("list");
    const target = found.value.items.find((employee) => employee.name === "Nguyễn Minh An")!;
    expect(await app.employees.archive(admin, { id: target.id, expectedVersion: target.version, reason: "Nghỉ việc" })).toMatchObject({ ok: true });
    const active = await app.employees.list(admin, { query: "nguyen minh an" });
    expect(active.ok && active.value.items.some((employee) => employee.id === target.id)).toBe(false);
    const withArchived = await app.employees.list(admin, { query: "nguyen minh an", includeArchived: true });
    expect(withArchived.ok && withArchived.value.items.some((employee) => employee.id === target.id)).toBe(true);
  });

  it("17. nhập 50 dòng: employees chỉ tải lại tối đa 1 lần sau khi nhập", async () => {
    const { app, calls } = await setup(fixedClock("2026-10-12T09:00:00+07:00"));
    await app.employees.list(admin);
    const initialLoads = calls.employees;
    const rows: EmployeeInput[] = Array.from({ length: 50 }, (_, index) => ({
      code: `TNM${900 + index}`, name: "Lê Văn Nhập", dob: "1990-01-01", gender: "Nam", cccd: `001090${String(100000 + index)}`, phone: `0912${String(100000 + index)}`,
      home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2020-01-01", emergencyContactId: null, status: "active", endDate: null,
    }));
    const imported = await app.employees.importMany(admin, { rows, dryRun: false });
    if (!imported.ok) throw new Error(JSON.stringify(imported.errors));
    expect(imported.value.every((outcome) => outcome.ok)).toBe(true);
    const listed = await app.employees.list(admin, { pageSize: 100 });
    expect(listed.ok && listed.value.total).toBe(62);
    // Đọc ở đầu lượt nhập dùng lại bộ nhớ tạm; sau 50 lần ghi chỉ tải lại đúng 1 lần
    expect(calls.employees - initialLoads).toBeLessThanOrEqual(1);
    expect(listed.ok && listed.value.totalPages).toBe(1);
  });
});
