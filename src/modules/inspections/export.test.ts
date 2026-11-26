import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildInspectionWorkbook } from "./export";
import type { Inspection } from "./types";

const inspection: Inspection = {
  id: "i1", projectId: "p1", number: "QHSE-P01-001", checkDate: "2026-09-16", reporterId: "u1", reporterName: "Sếp A", attentionEmployeeId: "e1", attentionName: "PM B", cc: "MR. C",
  status: "fixed", note: "", submittedAt: null, fixedAt: null, closedAt: null, createdAt: "",
  items: [
    { id: "a", seq: 1, location: "Factory 2FL", foundTime: "14:00", problem: "Chưa xiết ốc, marking", countermeasure: "Xiết ốc, marking", targetDate: "2026-09-16", beforePhoto: "x", beforeMarks: [], afterPhoto: "y", afterMarks: [], comment: "Đã xiết ốc", finishDate: "2026-09-18", fixedByName: "PM B", fixedAt: null },
    { id: "b", seq: 2, location: "Factory 2FL", foundTime: "14:30", problem: "Ống điện thiếu kẹp", countermeasure: "Lắp thêm kẹp", targetDate: null, beforePhoto: "x", beforeMarks: [], afterPhoto: null, afterMarks: [], comment: "", finishDate: null, fixedByName: "", fixedAt: null },
  ],
};

describe("Xuất Báo cáo công trình (QHSE PHOTO REPORT)", () => {
  it("đầu phiếu và từng khối lỗi Before / After", async () => {
    const bytes = await buildInspectionWorkbook({ inspection, project: { code: "P01", name: "Mega" }, photos: {} });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes.slice().buffer);
    const ws = book.worksheets[0]!;
    expect(ws.getCell("G2").value).toBe("QHSE PHOTO REPORT");
    expect(ws.getCell("F4").value).toBe("P01 Mega");
    expect(ws.getCell("U4").value).toBe("16/09/2026");
    expect(ws.getCell("U5").value).toBe("PM B");
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") texts.push(cell.value); }));
    expect(texts).toContain("Defect number: …2…");
    expect(texts).toContain("Chưa xiết ốc, marking");
    expect(texts).toContain("Đã xiết ốc");
    expect(texts).toContain("18/09/2026");
  });
});
