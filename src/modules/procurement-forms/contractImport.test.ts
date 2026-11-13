import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseContractWorkbook } from "./forms";

describe("parseContractWorkbook (nhập Confirm Contract P-COST-01)", () => {
  it("đọc các ô theo mẫu công ty, bỏ qua ô trống", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("R3");
    ws.getCell("Q2").value = "☑ Xác Nhận  /  ☐ Xác Nhận Tạm";
    ws.getCell("F12").value = new Date(Date.UTC(2026, 10, 1));
    ws.getCell("E14").value = "PR-01";
    ws.getCell("F16").value = "Lắp đặt hệ thống điện";
    ws.getCell("E19").value = "TNM Q-0001-2026";
    ws.getCell("Q19").value = "20/10/2026";
    ws.getCell("I21").value = 1_000_000;
    ws.getCell("L24").value = { formula: "I21", result: 950_000 };
    ws.getCell("G31").value = "Tạm ứng 30%,";
    ws.getCell("G32").value = "còn lại sau nghiệm thu";
    ws.getCell("E35").value = "Khách A";
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await parseContractWorkbook(bytes);
    expect(result.projectCode).toBe("PR-01");
    expect(result.fields).toEqual({
      confirmation: "confirmed", issuedOn: "2026-11-01", description: "Lắp đặt hệ thống điện", quoteNo: "TNM Q-0001-2026", quoteDate: "2026-10-20",
      quoteValue: 1_000_000, confirmedValue: 950_000, paymentTerms: "Tạm ứng 30%, còn lại sau nghiệm thu", customerName: "Khách A",
    });
  });
  it("file không theo mẫu thì báo lỗi", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("x").getCell("A1").value = "abc";
    await expect(parseContractWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()))).rejects.toThrow("CONTRACT_IMPORT_EMPTY");
  });
});
