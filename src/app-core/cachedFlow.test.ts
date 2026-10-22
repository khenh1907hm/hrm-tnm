import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { cacheRepositories } from "../repositories/cached";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { createHrApp } from "./createHrApp";

const admin = { id: "admin", role: "admin" as const };
const pdf = { id: "f-1", name: "ksk.pdf", mime: "application/pdf", size: 100 };

/** Chạy các luồng ghi rồi đọc qua bộ nhớ tạm như ở chế độ thật: kết quả phải thấy ngay thay đổi vừa ghi. */
describe("luồng nghiệp vụ qua bộ nhớ tạm", () => {
  it("thêm nhân sự, thêm và gia hạn chứng chỉ, danh sách và cảnh báo cập nhật ngay", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const { repositories } = cacheRepositories(await createDemoRepositories(clock, sequentialIds("seed-cache")), 30_000);
    const app = createHrApp({ clock, ids: sequentialIds("cache"), repositories });

    const before = await app.employees.list(admin, { pageSize: 100 });
    if (!before.ok) throw new Error("list");
    const created = await app.employees.create(admin, { code: "TNM950", name: "Lê Văn Cache", dob: "1990-01-01", gender: "Nam", cccd: "001090099950", phone: "0912000950", home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2020-01-01", emergencyContactId: null, status: "active", endDate: null });
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    const after = await app.employees.list(admin, { pageSize: 100 });
    expect(after.ok && after.value.total).toBe(before.value.total + 1);
    // Tạo trùng mã ngay sau đó phải bị chặn (đọc lại danh sách mới, không dùng bản cũ)
    const duplicate = await app.employees.create(admin, { ...created.value, photo: null, cccd: "001090099951", phone: "0912000951" });
    expect(!duplicate.ok && duplicate.errors.map((item) => item.code)).toContain("EMP_CODE_DUPLICATE");

    const added = await app.certificates.add(admin, { employeeId: created.value.id, type: "health", title: "", number: "KSK-950", issueDate: "2026-01-01", expiryDate: "2026-10-30", document: pdf, supplementaryFiles: [] });
    if (!added.ok) throw new Error(JSON.stringify(added.errors));
    const expiring = await app.certificates.listExpiring(admin);
    expect(expiring.ok && expiring.value.some((row) => row.id === added.value.id)).toBe(true);

    const renewed = await app.certificates.renew(admin, { id: added.value.id, expectedVersion: added.value.version, type: "health", title: "", number: "KSK-950B", issueDate: "2026-10-01", expiryDate: "2027-10-01", document: pdf, supplementaryFiles: [] });
    if (!renewed.ok) throw new Error(JSON.stringify(renewed.errors));
    const listed = await app.certificates.listByEmployee(admin, created.value.id);
    expect(listed.ok && listed.value.filter((item) => item.state === "current").map((item) => item.number)).toEqual(["KSK-950B"]);
    const expiringAfter = await app.certificates.listExpiring(admin);
    expect(expiringAfter.ok && expiringAfter.value.some((row) => row.employeeId === created.value.id)).toBe(false);
  });
});
