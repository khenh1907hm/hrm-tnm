import { describe, expect, it } from "vitest";
import { EMPLOYEE_VIEWS } from "./routes";
import { isLimitedRole, LIMITED_ROLE_INFO, parseProfileRole } from "./workspaceRole";

describe("workspaceRole", () => {
  it("đọc đúng các vai trò đã biết, kể cả Kỹ sư", () => {
    for (const role of ["admin", "hr", "engineer", "employee", "pending"]) expect(parseProfileRole(role)).toBe(role);
  });

  it("vai trò lạ hoặc thiếu hồ sơ → chờ cấp quyền", () => {
    expect(parseProfileRole("superuser")).toBe("pending");
    expect(parseProfileRole(undefined)).toBe("pending");
    expect(parseProfileRole(null)).toBe("pending");
  });

  it("Kỹ sư và Nhân viên dùng khung giới hạn; Admin, HR thì không", () => {
    expect(isLimitedRole("engineer")).toBe(true);
    expect(isLimitedRole("employee")).toBe(true);
    expect(isLimitedRole("admin")).toBe(false);
    expect(isLimitedRole("hr")).toBe(false);
    expect(isLimitedRole("pending")).toBe(false);
  });

  it("Kỹ sư mở thẳng trang Công cụ, nhãn Kỹ sư", () => {
    expect(LIMITED_ROLE_INFO.engineer.label).toBe("Kỹ sư");
    expect(LIMITED_ROLE_INFO.engineer.home).toBe("tools");
    expect(LIMITED_ROLE_INFO.engineer.nav[0]).toBe("tools");
  });

  it("khung giới hạn chỉ có các màn hình được phép", () => {
    for (const info of Object.values(LIMITED_ROLE_INFO)) {
      expect([...info.nav].sort()).toEqual([...EMPLOYEE_VIEWS].sort());
      expect(EMPLOYEE_VIEWS).toContain(info.home);
    }
  });
});
