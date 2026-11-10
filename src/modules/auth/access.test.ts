import { describe, expect, it } from "vitest";
import { ACCESS_ITEMS, ACCESS_KEYS, actorFromProfile, can, defaultAccess, effectiveAccess, hasAccess, needsHrWorkspace, normalizeAccess, PERMISSIONS, toggleAccess, type Permission } from "./permissions";

const permissions = Object.keys(PERMISSIONS) as Permission[];

describe("quyền theo từng người", () => {
  it("HR chưa tùy chỉnh giữ đúng bảng quyền cũ, nên migration không đổi quyền của ai", () => {
    for (const permission of permissions) {
      expect(can({ id: "u", role: "hr" }, permission)).toBe((PERMISSIONS[permission] as readonly string[]).includes("hr"));
    }
  });

  it("Admin luôn đủ quyền, kể cả có danh sách tùy chỉnh lọt vào", () => {
    for (const permission of permissions) expect(can({ id: "u", role: "admin", access: [] }, permission)).toBe(true);
    expect(actorFromProfile("u", "admin", ["tools"])).toEqual({ id: "u", role: "admin" });
  });

  it("Nhật ký không mở qua tick quyền, kể cả tick đủ mọi mục", () => {
    expect(can({ id: "u", role: "hr", access: ACCESS_KEYS }, "auditRead")).toBe(false);
  });

  it("Kỹ sư mặc định chỉ có Công cụ, không vào được dữ liệu nhân sự", () => {
    const engineer = { id: "u", role: "engineer" } as const;
    expect(defaultAccess("engineer")).toEqual(["tools"]);
    for (const permission of permissions) expect(can(engineer, permission)).toBe(false);
    expect(needsHrWorkspace(effectiveAccess("engineer", null))).toBe(false);
  });

  it("Kỹ sư được tick Xuất nhân sự thì xuất được nhưng không sửa, không nhập", () => {
    const actor = actorFromProfile("u", "engineer", ["employees.export"])!;
    expect(can(actor, "export")).toBe(true);
    expect(can(actor, "employeeRead")).toBe(true);
    expect(can(actor, "employeeWrite")).toBe(false);
    expect(can(actor, "employeeImport")).toBe(false);
    expect(hasAccess(actor, "tools")).toBe(false);
    expect(needsHrWorkspace(actor.access!)).toBe(true);
  });

  it("HR bị bỏ tick Nhập thì không nhập được nhưng vẫn sửa được", () => {
    const actor = actorFromProfile("u", "hr", ACCESS_KEYS.filter((key) => key !== "employees.import"))!;
    expect(can(actor, "employeeImport")).toBe(false);
    expect(can(actor, "employeeWrite")).toBe(true);
  });

  it("danh sách rỗng là thu hết quyền, khác với chưa tùy chỉnh", () => {
    expect(effectiveAccess("hr", [])).toEqual([]);
    expect(effectiveAccess("hr", null)).toEqual(ACCESS_KEYS.filter((key) => key !== "projects.manage"));
  });

  it("Chờ cấp quyền hay vai trò lạ không có gì, kể cả còn danh sách cũ", () => {
    expect(effectiveAccess("pending", ACCESS_KEYS)).toEqual([]);
    expect(actorFromProfile("u", "pending", ACCESS_KEYS)).toBeNull();
    expect(actorFromProfile("u", "superuser", null)).toBeNull();
  });

  it("chuẩn hóa: bỏ khóa lạ, tự thêm mục bắt buộc", () => {
    expect(normalizeAccess(["employees.export", "xoa-het", 1])).toEqual(["employees.view", "employees.export"]);
  });

  it("tick một mục kéo theo mục cần, bỏ mục gốc kéo theo mục phụ thuộc", () => {
    expect(toggleAccess([], "certificates.edit", true)).toEqual(["employees.view", "certificates.edit"]);
    expect(toggleAccess(["employees.view", "certificates.edit", "signatures.manage"], "employees.view", false)).toEqual(["signatures.manage"]);
    expect(toggleAccess(["employees.view", "certificates.edit"], "certificates.edit", false)).toEqual(["employees.view"]);
  });

  it("mọi mục bắt buộc đều có trong danh mục", () => {
    for (const item of ACCESS_ITEMS) for (const needed of item.requires) expect(ACCESS_KEYS).toContain(needed);
  });
});
