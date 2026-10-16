import { describe, expect, it } from "vitest";
import { createHrApp } from "./createHrApp";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import type { EmployeeInput } from "../modules/employees/types";

const admin = { id: "actor-admin", role: "admin" as const };
const hr = { id: "actor-hr", role: "hr" as const };
const base: EmployeeInput = {
  code: "TNM901", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: null, status: "active", endDate: null,
};
const second: EmployeeInput = { ...base, code: "TNM902", name: "Trần Thị Bình", gender: "Nữ", cccd: "079188012346", phone: "0912345678" };
const newApp = () => createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("imp") });
const codes = (outcome: { ok: boolean; errors?: { code: string }[] }) => (outcome.ok ? [] : outcome.errors!.map((item) => item.code));

describe("nhập nhiều hồ sơ từ Excel", () => {
  it("chỉ Admin được nhập", async () => {
    expect((await newApp().employees.importMany(hr, { rows: [base], dryRun: true })).ok).toBe(false);
  });

  it("chạy thử không lưu gì", async () => {
    const app = newApp();
    const before = await app.employees.list(admin, { pageSize: 100 });
    const result = await app.employees.importMany(admin, { rows: [base, second], dryRun: true });
    expect(result.ok && result.value.map((item) => item.ok)).toEqual([true, true]);
    const after = await app.employees.list(admin, { pageSize: 100 });
    expect(after.ok && before.ok && after.value.total).toBe(before.ok ? before.value.total : -1);
  });

  it("lưu dòng hợp lệ, ghi nhật ký, bỏ dòng lỗi và vẫn chạy tiếp", async () => {
    const app = newApp();
    const result = await app.employees.importMany(admin, { rows: [base, { ...second, code: "ABC" }, { ...second, code: "TNM903" }], dryRun: false });
    if (!result.ok) throw new Error("import failed");
    expect(result.value.map((item) => item.ok)).toEqual([true, false, true]);
    expect(codes(result.value[1]!)).toContain("EMP_CODE_INVALID");
    const saved = await app.employees.search(admin, { query: "TNM903" });
    expect(saved.ok && saved.value.items.map((item) => item.code)).toEqual(["TNM903"]);
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.filter((event) => event.action === "employee.import")).toHaveLength(2);
  });

  it("bắt trùng mã và CCCD ngay trong cùng một file", async () => {
    const result = await newApp().employees.importMany(admin, { rows: [base, { ...second, code: base.code }, { ...second, cccd: base.cccd }], dryRun: true });
    if (!result.ok) throw new Error("import failed");
    expect(codes(result.value[1]!)).toContain("EMP_CODE_DUPLICATE");
    expect(codes(result.value[2]!)).toContain("CCCD_DUPLICATE");
  });

  it("không cho ghi đè CCCD lệch ngày sinh khi nhập hàng loạt", async () => {
    const result = await newApp().employees.importMany(admin, { rows: [{ ...base, dob: "1990-05-12", mismatchOverrideReason: "Đã đối chiếu hồ sơ" }], dryRun: true });
    expect(result.ok && codes(result.value[0]!)).toContain("CCCD_DOB_MISMATCH");
  });
});
