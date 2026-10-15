import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { scanTemplate } from "./scanTemplate";

async function bytesOf(workbook: ExcelJS.Workbook) {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("scanTemplate", () => {
  it("finds the form sheet, placeholder keys, print area and IMG_ image slots", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Huong dan").getCell("A1").value = "Không có ô giữ chỗ";
    const sheet = workbook.addWorksheet("Phieu thong tin");
    sheet.getCell("B2").value = "{{fullNameUpper}}";
    sheet.getCell("B3").value = "Date/Ngày: {{exportDate}} – {{ projectStartDate }}";
    sheet.getCell("B4").value = "{{fullNameUpper}}";
    sheet.getCell("B5").value = 42;
    sheet.columns = [{ width: 10 }, { width: 10 }, {}];
    sheet.getRow(8).height = 30;
    sheet.pageSetup.printArea = "B1:F20";
    workbook.definedNames.add("'Phieu thong tin'!$A$8:$B$9", "IMG_photo3x4");
    workbook.definedNames.add("'Phieu thong tin'!$C$10:$C$10", "img_cccdImage");
    workbook.definedNames.add("'Phieu thong tin'!$A$1:$A$2", "VungKhac");

    const scan = await scanTemplate(await bytesOf(workbook));
    expect(scan.sheetName).toBe("Phieu thong tin");
    expect(scan.placeholders).toEqual(["fullNameUpper", "exportDate", "projectStartDate"]);
    expect(scan.printArea).toBe("B1:F20");
    expect(scan.imageSlots).toEqual([{ field: "photo3x4", range: "A8:B9" }, { field: "cccdImage", range: "C10" }]);
    // A8:B9 = 2 cột × 75px, cao 40px + 20px
    expect(scan.slotAspect.photo3x4).toBeCloseTo(150 / 60);
    expect(scan.slotAspect.cccdImage).toBeCloseTo(64 / 20);
  });

  it("falls back to the first sheet when there is no placeholder and handles missing print area", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Trang 1");
    workbook.addWorksheet("Trang 2");
    const scan = await scanTemplate(await bytesOf(workbook));
    expect(scan).toEqual({ sheetName: "Trang 1", placeholders: [], printArea: null, imageSlots: [], slotAspect: {} });
  });

  it("rejects a workbook without sheets", async () => {
    await expect(scanTemplate(await bytesOf(new ExcelJS.Workbook()))).rejects.toThrow("không có sheet");
  });
});
