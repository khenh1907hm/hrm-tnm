import { describe, expect, it } from "vitest";
import { EMPLOYEE_VIEWS, parseRoute, projectPath, routePath, VIEW_PATHS } from "./routes";

describe("routes", () => {
  it("trang gốc mở danh sách nhân sự", () => {
    expect(parseRoute("/")).toEqual({ view: "employees", employeeId: null });
  });

  it("mỗi màn hình có URL riêng và đọc lại đúng", () => {
    for (const [view, path] of Object.entries(VIEW_PATHS)) {
      expect(parseRoute(path)).toEqual({ view, employeeId: null });
      expect(parseRoute(`${path}/`)).toEqual({ view, employeeId: null });
    }
  });

  it("mở thẳng hồ sơ nhân sự theo id", () => {
    expect(routePath("employees", "emp 1")).toBe("/nhan-su/emp%201");
    expect(parseRoute("/nhan-su/emp%201")).toEqual({ view: "employees", employeeId: "emp 1" });
  });

  it("mở thẳng một dự án theo id", () => {
    expect(projectPath("da 1")).toBe("/du-an/da%201");
    expect(parseRoute("/du-an/da%201")).toEqual({ view: "projects", employeeId: null, projectId: "da 1" });
    expect(parseRoute("/cham-cong/x")).toBeNull();
  });

  it("bỏ qua employeeId ở màn hình khác", () => {
    expect(routePath("alerts", "x")).toBe("/canh-bao");
  });

  it("trang Công cụ có URL riêng; Nhân viên chỉ vào Kho Skill AI và Công cụ", () => {
    expect(routePath("tools")).toBe("/cong-cu");
    expect(parseRoute("/cong-cu")).toEqual({ view: "tools", employeeId: null });
    expect(EMPLOYEE_VIEWS).toEqual(["skills", "tools", "projects", "timesheet", "purchases"]);
  });

  it("đường dẫn lạ thì trả null", () => {
    expect(parseRoute("/khong-co")).toBeNull();
    expect(parseRoute("/canh-bao/x")).toBeNull();
    expect(parseRoute("/nhan-su/a/b")).toBeNull();
    expect(parseRoute("/nhan-su/%E0")).toBeNull();
  });
});
