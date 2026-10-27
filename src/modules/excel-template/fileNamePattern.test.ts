import { describe, expect, it } from "vitest";
import { applyFileNamePattern } from "./fileNamePattern";

const duc = { code: "TNM0018", name: "Trần Ngọc Đức", position: "Nhân viên hiện trường" };

describe("applyFileNamePattern (quy tắc đặt tên tệp xuất)", () => {
  it("điền mã và tên theo quy tắc dự án Vinci", () => {
    expect(applyFileNamePattern("Vinci - {mã nhân viên} - {Tên nhân viên}", duc, "2026-10-27")).toEqual({ name: "Vinci - TNM0018 - Trần Ngọc Đức", unknownTokens: [] });
  });

  it("nhận biến viết hoa/thường, có dấu hay không dấu, và các tên gọi khác", () => {
    expect(applyFileNamePattern("{MA NV}_{ho ten}_{Chức vụ}_{ngày xuất}", duc, "2026-10-27").name).toBe("TNM0018_Trần Ngọc Đức_Nhân viên hiện trường_27-10-2026");
  });

  it("đổi ký tự cấm trong tên tệp Windows và báo biến không nhận ra", () => {
    const result = applyFileNamePattern("Hồ sơ: {mã nhân viên}/{không có}?", duc, "2026-10-27");
    expect(result.name).toBe("Hồ sơ- TNM0018-{không có}-");
    expect(result.unknownTokens).toEqual(["{không có}"]);
  });
});
