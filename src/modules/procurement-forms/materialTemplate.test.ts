import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fillMaterialRequest } from "./forms";
import type { MaterialRequest } from "../purchases/materials";

const template = readFileSync("public/templates/quy-trinh/P-COST-08.xlsx");
const request = (count: number): MaterialRequest => ({
  id: "r1", projectId: "p1", number: "YCVT-P01-001", requesterName: "Người Yêu Cầu", requestedOn: "2026-11-26", status: "approved", note: "Cần gấp",
  createdAt: "2026-11-26T00:00:00Z", submittedAt: null, approvedAt: null, orderIds: [],
  items: Array.from({ length: count }, (_, index) => ({ id: `i${index}`, name: `Vật tư ${index + 1}`, spec: "2x1.5", maker: "Cadivi", unit: "m", quantity: index + 1, neededOn: "2026-12-01", note: "", budgetCode: null })),
});
const load = async (bytes: Uint8Array) => { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes.slice().buffer); return book.worksheets[0]!; };

describe("P-COST-08 theo khung mẫu công ty", () => {
  it("điền thông tin đầu phiếu và bảng vật tư đúng ô", async () => {
    const ws = await load(await fillMaterialRequest(template, { request: request(3), project: { code: "P01", name: "Dự án A", site: "" }, steps: [] }));
    expect(ws.getCell("A8").value).toBe("PHIẾU YÊU CẦU VẬT TƯ");
    expect(ws.getCell("C10").value).toBe("Dự án A");
    expect(ws.getCell("C11").value).toBe("P01");
    expect(ws.getCell("H10").value).toBe("26/11/2026");
    expect(ws.getCell("B14").value).toBe("Vật tư 1");
    expect(ws.getCell("G16").value).toBe(3);
    expect(ws.getCell("B36").value).toBe("Lãnh Đạo");
    expect(String(ws.getCell("I37").value)).toContain("Người Yêu Cầu");
  });
  it("nhiều hơn 21 dòng thì chèn thêm, ô ký dời xuống", async () => {
    const ws = await load(await fillMaterialRequest(template, { request: request(25), project: { code: "P01", name: "Dự án A", site: "" }, steps: [] }));
    expect(ws.getCell("B38").value).toBe("Vật tư 25");
    expect(ws.getCell("B40").value).toBe("Lãnh Đạo");
    expect(ws.getCell("I40").value).toBe("Người Yêu Cầu");
  });
});
