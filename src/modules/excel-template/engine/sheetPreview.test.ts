import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildSheetPreview } from "./sheetPreview";

async function template() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Phieu");
  sheet.columns = [{ width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }];
  sheet.getRow(1).height = 30;
  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = "PHIẾU THÔNG TIN";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell("A2").value = "Họ tên: {{fullNameUpper}}";
  sheet.getCell("A2").border = { bottom: { style: "thin" } };
  sheet.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  sheet.mergeCells("C3:D5");
  sheet.getCell("E9").value = "ngoài vùng in";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("buildSheetPreview", () => {
  it("đặt ô, ô gộp, chữ, mã {{…}}, viền, màu nền theo pixel của vùng in", async () => {
    const preview = await buildSheetPreview(await template(), "Phieu", "A1:D6");
    expect(preview).not.toBeNull();
    // 4 cột × 70px (độ rộng 10 theo Excel), dòng 1 cao 30pt = 40px, 5 dòng còn lại mặc định 15pt = 20px
    expect(preview!.width).toBe(280);
    expect(preview!.height).toBe(40 + 5 * 20);
    const title = preview!.cells.find((cell) => cell.address === "A1")!;
    expect(title).toMatchObject({ x: 0, y: 0, width: 280, height: 40, text: "PHIẾU THÔNG TIN", bold: true, align: "center", valign: "middle" });
    expect(preview!.cells.find((cell) => cell.address === "A2")).toMatchObject({ placeholders: ["fullNameUpper"], border: [false, false, true, false] });
    expect(preview!.cells.find((cell) => cell.address === "B3")?.fill).toBe("#FFFF00");
    // Ô ngoài vùng in không vẽ
    expect(preview!.cells.some((cell) => cell.text === "ngoài vùng in")).toBe(false);
  });

  it("đổi vùng ô ra hộp pixel, ô gộp lấy cả khối, ngoài vùng in thì null", async () => {
    const preview = (await buildSheetPreview(await template(), "Phieu", "A1:D6"))!;
    expect(preview.boxOf("B2:C2")).toEqual({ x: 70, y: 40, width: 140, height: 20 });
    expect(preview.boxOf("C3")).toEqual({ x: 140, y: 60, width: 140, height: 60 });
    expect(preview.boxOf("$A$1")).toEqual({ x: 0, y: 0, width: 280, height: 40 });
    expect(preview.boxOf("E9")).toBeNull();
    expect(preview.boxOf("không phải ô")).toBeNull();
  });
});
