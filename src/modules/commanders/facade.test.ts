import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import type { Actor } from "../auth/permissions";

describe("commanders facade and RBAC", () => {
  const admin: Actor = { id: "admin-1", role: "admin" };
  const hr: Actor = { id: "hr-1", role: "hr" };

  function setupApp() {
    return createHrApp({
      clock: fixedClock("2026-10-12T09:00:00+07:00"),
      ids: sequentialIds("cmd-facade"),
    });
  }

  it("allows Admin to list, create, update and archive commanders; HR can only list", async () => {
    const app = setupApp();

    const listHr = await app.commanders.list(hr);
    expect(listHr.ok).toBe(true);
    if (!listHr.ok) throw new Error("Expected success");
    expect(listHr.value.length).toBe(2);

    const createHr = await app.commanders.create(({ id: "outsider", role: "pending" } as never), {
      name: "Nguyễn Văn Mới",
      role: "Chỉ huy trưởng công trường",
      phone: "0901234567",
      address: "Địa chỉ mới",
    });
    expect(createHr.ok).toBe(false);
    if (createHr.ok) throw new Error("Expected forbidden");
    expect(createHr.errors[0]?.code).toBe("FORBIDDEN");

    const created = await app.commanders.create(admin, {
      name: "Nguyễn Văn Mới",
      role: "Chỉ huy trưởng công trường",
      phone: "0901234567",
      address: "Địa chỉ mới",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected success");
    expect(created.value.name).toBe("Nguyễn Văn Mới");

    const updated = await app.commanders.update(admin, {
      id: created.value.id,
      expectedVersion: created.value.version,
      name: "Nguyễn Văn Mới Đổi Tên",
      role: "Chỉ huy phó",
      phone: "0901234567",
      address: "Địa chỉ đã đổi",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("Expected success");
    expect(updated.value.name).toBe("Nguyễn Văn Mới Đổi Tên");
    expect(updated.value.role).toBe("Chỉ huy phó");

    const archived = await app.commanders.archive(admin, {
      id: created.value.id,
      expectedVersion: updated.value.version,
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("Expected success");
    expect(archived.value.archived).toBe(true);
  });

  it("prevents archiving a commander that is currently assigned to an active employee", async () => {
    const app = setupApp();

    const emp = await app.employees.create(admin, {
      code: "TNM999",
      name: "Trần Văn Test",
      dob: "1990-01-01",
      gender: "Nam",
      cccd: "079090000001",
      phone: "0839999999",
      home: "Tỉnh mẫu",
      address: "Địa chỉ mẫu",
      position: "Nhân viên hiện trường",
      group: 1,
      startDate: "2024-01-01",
      emergencyContactId: "cmd-1",
      status: "active",
      endDate: null,
    });
    expect(emp.ok).toBe(true);

    const commanders = await app.commanders.list(admin);
    if (!commanders.ok) throw new Error("Expected success");
    const cmd1 = commanders.value.find((c) => c.id === "cmd-1");
    if (!cmd1) throw new Error("Expected cmd-1");

    const archiveResult = await app.commanders.archive(admin, {
      id: cmd1.id,
      expectedVersion: cmd1.version,
    });
    expect(archiveResult.ok).toBe(false);
    if (archiveResult.ok) throw new Error("Expected error");
    expect(archiveResult.errors[0]?.code).toBe("COMMANDER_IN_USE");
  });

  it("provides certificates.preview that validates inputs and returns warnings before saving", async () => {
    const app = setupApp();

    const emp = await app.employees.create(admin, {
      code: "TNM998",
      name: "Lê Văn Chứng",
      dob: "1992-02-02",
      gender: "Nam",
      cccd: "079092000002",
      phone: "0839999998",
      home: "Tỉnh mẫu",
      address: "Địa chỉ mẫu",
      position: "Nhân viên hiện trường",
      group: 1,
      startDate: "2024-01-01",
      emergencyContactId: "cmd-1",
      status: "active",
      endDate: null,
    });
    if (!emp.ok) throw new Error("Failed to create employee");

    const previewExpired = await app.certificates.preview(admin, {
      employeeId: emp.value.id,
      type: "atld",
      number: "ATLĐ-TEST-01",
      issueDate: "2023-01-01",
      expiryDate: "2024-01-01",
      document: { id: "doc-1", name: "doc.pdf", mime: "application/pdf", size: 1024 },
      title: "",
    });
    expect(previewExpired.ok).toBe(true);
    expect(previewExpired.warnings.some((w: { code: string }) => w.code === "CERT_ALREADY_EXPIRED")).toBe(true);
  });
});
