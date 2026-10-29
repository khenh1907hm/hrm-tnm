import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { auditActionLabel, auditChanges, auditSubject, formatAuditValue, stripDataUrls } from "../modules/audit/describe";
import type { EmployeeInput } from "../modules/employees/types";
import { createSupabaseRepositories } from "../repositories/supabase/createSupabaseRepositories";
import { createFakeSupabase } from "../repositories/supabase/fakeSupabase";
import { createHrApp } from "./createHrApp";

const admin = { id: "actor-admin", role: "admin" as const };
const hr = { id: "actor-hr", role: "hr" as const };
const employee: EmployeeInput = {
  code: "TNM901", name: "Trần Văn Nhật", dob: "1990-01-02", gender: "Nam", cccd: "038090012345", phone: "0912345678",
  home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2024-01-15", emergencyContactId: null, status: "active", endDate: null,
};

describe("audit log screen", () => {
  it("AUD_04 drops base64 images from audit snapshots but keeps file references", () => {
    const photo = { id: "p1", name: "anh.jpg", mime: "image/jpeg", size: 10 };
    const stripped = stripDataUrls({ photo: "data:image/png;base64,AAAA", nested: [{ image: "data:image/jpeg;base64,BBBB" }], ref: photo, name: "An" });
    expect(stripped).toEqual({ photo: "data:(đã lược bỏ)", nested: [{ image: "data:(đã lược bỏ)" }], ref: photo, name: "An" });
    expect(stripDataUrls(stripped)).toEqual(stripped);
  });

  it("AUD_05 pages newest first, filters by entity and is admin only", async () => {
    let tick = 0;
    const clock = { now: () => new Date(Date.UTC(2026, 9, 16, 2, 0, tick++)).toISOString() };
    const app = createHrApp({ clock: { ...fixedClock("2026-10-16T09:00:00+07:00"), now: clock.now }, ids: sequentialIds("aud") });
    const created = await app.employees.create(admin, employee);
    if (!created.ok) throw new Error("create failed");
    await app.employees.archive(admin, { id: created.value.id, expectedVersion: 1, reason: "Nghỉ dài hạn" });
    const hoa = await app.employees.create(admin, { ...employee, code: "TNM902", cccd: "001190012345", phone: "0912345679", name: "Lê Thị Hoa", gender: "Nữ", dob: "1990-01-02" });
    expect(hoa.ok).toBe(true);

    expect((await app.audit.page(hr)).ok).toBe(false);
    const first = await app.audit.page(admin, { pageSize: 2 });
    if (!first.ok) throw new Error("page failed");
    expect(first.value).toMatchObject({ total: 3, page: 1, pageSize: 2, pageCount: 2 });
    expect(first.value.items.map((event) => event.action)).toEqual(["employee.create", "employee.archive"]);
    const second = await app.audit.page(admin, { pageSize: 2, page: 2 });
    expect(second.ok && second.value.items.map((event) => event.action)).toEqual(["employee.create"]);

    const onePerson = await app.audit.page(admin, { entityType: "employee", entityId: created.value.id });
    expect(onePerson.ok && onePerson.value.items.map((event) => event.action)).toEqual(["employee.archive", "employee.create"]);
    const certificates = await app.audit.page(admin, { entityType: "certificate" });
    expect(certificates.ok && certificates.value.total).toBe(0);
    // Cỡ trang bị giới hạn
    const huge = await app.audit.page(admin, { pageSize: 5000, page: 0 });
    expect(huge.ok && huge.value).toMatchObject({ pageSize: 100, page: 1 });
  });

  it("AUD_05 Supabase paging uses one ordered, counted range query", async () => {
    const { client } = createFakeSupabase();
    const repositories = createSupabaseRepositories(client);
    for (const [id, at, type] of [["a1", "2026-10-16T01:00:00Z", "employee"], ["a2", "2026-10-16T03:00:00Z", "certificate"], ["a3", "2026-10-16T02:00:00Z", "employee"]] as const) {
      await repositories.audit.append({ id, at, actorId: "u1", role: "admin", action: "x", entityType: type, entityId: "e1", before: null, after: null });
    }
    expect(await repositories.audit.page({ offset: 0, limit: 2 })).toMatchObject({ total: 3, items: [{ id: "a2" }, { id: "a3" }] });
    expect(await repositories.audit.page({ offset: 2, limit: 2 })).toMatchObject({ total: 3, items: [{ id: "a1" }] });
    expect(await repositories.audit.page({ offset: 0, limit: 10, entityType: "employee" })).toMatchObject({ total: 2, items: [{ id: "a3" }, { id: "a1" }] });
  });

  it("AUD_05 describes actions, subjects and changed fields in Vietnamese", () => {
    expect(auditActionLabel("employee.update")).toBe("Sửa hồ sơ nhân sự");
    expect(auditActionLabel("unknown.action")).toBe("unknown.action");
    const event = {
      entityType: "employee", entityId: "e1",
      before: { id: "e1", version: 1, name: "Trần Văn Nhật", code: "TNM901", phone: "0912345678", status: "active", photo: "data:(đã lược bỏ)", currentAddress: "" },
      after: { id: "e1", version: 2, expectedVersion: 1, name: "Trần Văn Nhật", code: "TNM901", phone: "0987654321", status: "on_leave", photo: { id: "p1", name: "anh.jpg", mime: "image/jpeg", size: 10 } },
    };
    expect(auditSubject(event)).toBe("Trần Văn Nhật (TNM901)");
    expect(auditChanges(event)).toEqual([
      { field: "phone", label: "Điện thoại", before: "0912345678", after: "0987654321" },
      { field: "status", label: "Trạng thái", before: "Đang làm việc", after: "Tạm nghỉ" },
      { field: "photo", label: "Ảnh 3×4", before: "(ảnh)", after: "anh.jpg" },
    ]);
    expect(auditChanges({ before: null, after: null })).toEqual([]);
    expect(auditChanges({ action: "cccd.reveal", before: null, after: { employeeId: "e1", name: "Trần Văn Nhật", code: "TNM901", cccd: "038•••••2345" } })).toEqual([]);
    expect(auditSubject({ entityType: "employee", entityId: "e1", before: null, after: { employeeId: "e1", name: "Trần Văn Nhật", code: "TNM901" } })).toBe("Trần Văn Nhật (TNM901)");
    expect(auditSubject({ entityType: "certificate", entityId: "c1", before: null, after: { number: "AT-01" } })).toBe("Số AT-01");
    expect(auditSubject({ entityType: "settings", entityId: "global", before: null, after: null })).toBe("Cài đặt chung");
    expect(formatAuditValue({ reminderEmails: ["a@b.vn"], sendExpiredNotice: true })).toBe("Email nhận nhắc hạn: a@b.vn; Nhắc cả chứng chỉ đã hết hạn: Có");
  });
});
