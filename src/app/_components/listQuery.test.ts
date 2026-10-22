import { describe, expect, it } from "vitest";
import { DEFAULT_EMPLOYEE_FILTERS } from "./EmployeeListView";
import { filtersFromSearch, filtersToSearch } from "./listQuery";

describe("bộ lọc danh sách trên URL", () => {
  it("mặc định khớp đủ mọi loại chứng chỉ; mode=any thì khớp một trong", () => {
    expect(DEFAULT_EMPLOYEE_FILTERS.certificateTypeMode).toBe("all");
    expect(filtersFromSearch("?mode=any").certificateTypeMode).toBe("any");
  });

  it("mặc định thì URL sạch; đọc lại đúng mọi giá trị đã ghi", () => {
    expect(filtersToSearch(DEFAULT_EMPLOYEE_FILTERS)).toBe("");
    const filters = { ...DEFAULT_EMPLOYEE_FILTERS, query: "nguyễn văn", page: 3, pageSize: 50, positions: ["Giám đốc", "Nhân viên hiện trường"], statuses: ["active" as const], certificateHealth: ["expired" as const, "missing" as const], certificateTypes: ["atld"], certificateTypeMode: "all" as const, includeArchived: true, sort: "name" as const, sortDir: "desc" as const };
    const search = filtersToSearch(filters);
    expect(search).toContain("page=3");
    expect(filtersFromSearch(search)).toEqual(filters);
  });

  it("giá trị lạ hoặc hỏng trên URL thì bỏ qua, không làm vỡ màn hình", () => {
    expect(filtersFromSearch("?page=-4&size=9999&st=xyz&cert=ok&sort=hack&dir=sideways")).toEqual({ ...DEFAULT_EMPLOYEE_FILTERS, page: 1, pageSize: 100, certificateHealth: ["ok"] });
    expect(filtersFromSearch("?page=abc").page).toBe(1);
  });
});
