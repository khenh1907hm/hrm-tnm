import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildToolCheckWorkbook, missingCount, parseToolCheck } from "./toolCheck";

// JPEG 1x1 nhỏ nhất hợp lệ
const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64")).buffer;

describe("toolCheck", () => {
  const check = parseToolCheck({
    id: "1", check_date: "2026-09-25", checked_by: "P.TRUNG", updated_at: "",
    rows: [
      { serial: "MÁY CẮT BÀN", subcon: "TNM", typeName: "Máy điện có dây", items: ["outlook", "earthing", "resistance", "function"], photos: { outlook: "p/a.jpg", earthing: "p/b.jpg" }, result: "OK" },
      { serial: "MÁY KHOAN PIN 01", subcon: "TNM", items: ["outlook", "function", "bogus"], photos: {}, result: "NG", note: "vỡ vỏ" },
    ],
  });

  it("đọc dòng, bỏ mục lạ, đếm ảnh thiếu", () => {
    expect(check.rows[1]!.items).toEqual(["outlook", "function"]);
    expect(check.rows[1]!.result).toBe("NG");
    expect(missingCount(check)).toBe(4);
  });

  it("xuất Excel theo mẫu: tiêu đề, gạch chéo ô không áp dụng, ảnh, kết quả", async () => {
    const images = new Map([["p/a.jpg", { buffer: JPEG, width: 1280, height: 960 }]]);
    const bytes = await buildToolCheckWorkbook(check, { code: "DA-01", name: "Mega" }, images);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.getWorksheet("Electrical tool & machine")!;
    expect(ws.getCell("B2").value).toBe("TOOL & MACHINE CHECK PHOTO REPORT");
    expect(ws.getCell("D8").value).toBe("Out look check");
    expect(ws.getCell("B9").value).toBe("MÁY CẮT BÀN");
    expect(ws.getCell("E9").value).toBe("(photo not loaded)");
    expect(ws.getCell("F9").value).toBe("No photo");
    expect(ws.getCell("E10").value).toBeNull();
    expect(ws.getCell("E10").border.diagonal?.up).toBe(true);
    expect(ws.getCell("H10").value).toBe("NG");
    expect(ws.getImages()).toHaveLength(1);
  });
});
