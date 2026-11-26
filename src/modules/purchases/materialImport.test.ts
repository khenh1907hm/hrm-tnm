import { describe, expect, it } from "vitest";
import { parseMaterialGrid, toIsoDate } from "./materialImport";

// Bố cục giống mẫu P-COST-08: nhãn ở cột A / F, tiêu đề dòng 13, tên vật tư ở ô gộp B:C, khối ký bên dưới
const grid = [
  [null, null, "THIEN NHAT MINH Co. Ltd"],
  [],
  ["PHIẾU YÊU CẦU VẬT TƯ"],
  ["Tên Dự án", null, "Nhà máy A", null, null, "Ngày yêu cầu:", null, "26/11/2026"],
  ["Số Dự Án", null, "P2026-01", null, null, "Người yêu cầu:", null, "Nguyễn Văn A"],
  [],
  ["STT", "Tên vật tư", null, "Thông số kỹ thuật", "nhà sản xuất", "Đơn vị", "Số lượng", "Ngày Cần sử dụng", "Ghi chú"],
  [1, "Cáp điện", null, "CVV 2x1.5", "Cadivi", "m", 120, 46357, "Tầng 1"],
  [2, "Ống luồn", null, "D20", "", "cây", "1.234,5", "05/12/2026", ""],
  [null, null, null, null, null, null, null, null, null],
  [null, "Lãnh Đạo", null, "P. Kỹ Thuật", null, "Phòng Vật Tư, Kho", null, null, "Người Yêu Cầu"],
  [null, "Không phải vật tư", null, null, null, "cái", 5],
];

describe("Nhập phiếu yêu cầu vật tư từ file mẫu P-COST-08", () => {
  it("đọc thông tin đầu phiếu và các dòng vật tư, dừng ở khối ký", () => {
    const result = parseMaterialGrid(grid);
    expect(result.projectName).toBe("Nhà máy A");
    expect(result.projectCode).toBe("P2026-01");
    expect(result.requestedOn).toBe("2026-11-26");
    expect(result.requester).toBe("Nguyễn Văn A");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ name: "Cáp điện", spec: "CVV 2x1.5", maker: "Cadivi", unit: "m", quantity: 120, neededOn: "2026-12-01", note: "Tầng 1" });
    expect(result.items[1]).toMatchObject({ name: "Ống luồn", quantity: 1234.5, neededOn: "2026-12-05" });
  });
  it("mẫu trống thì không có dòng nào, ô đầu phiếu trống không lấy nhầm nhãn bên phải", () => {
    const empty = grid.map((row, index) => index === 3 ? ["Tên Dự án", null, null, null, null, "Ngày yêu cầu:"] : index === 4 ? ["Số Dự Án", null, null, null, null, "Người yêu cầu:"] : row).filter((_, index) => index < 7 || index > 8);
    const result = parseMaterialGrid(empty);
    expect(result.projectName).toBe("");
    expect(result.items).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Không có dòng/);
  });
  it("không có dòng tiêu đề thì báo lỗi", () => expect(() => parseMaterialGrid([["a", "b"]])).toThrow("MR_IMPORT_NO_HEADER"));
  it("đổi ngày", () => { expect(toIsoDate(46357)).toBe("2026-12-01"); expect(toIsoDate("2026-12-01")).toBe("2026-12-01"); expect(toIsoDate("abc")).toBeNull(); });
});
