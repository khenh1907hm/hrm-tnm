import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildMappingRules, fieldsWithoutAlias, mergeAiTemplate } from "./mappingPlan";
import { scanTemplate } from "./scanTemplate";
import { placeFieldCodes, removeFieldCode, templateFieldCatalog } from "./templateEdits";

async function rawTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Phieu");
  sheet.getCell("A1").value = "FULL NAME/HỌ VÀ TÊN";
  sheet.mergeCells("B1:D1");
  sheet.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  sheet.getCell("A2").value = "Ngày sinh:";
  sheet.getCell("A2").font = { bold: true };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function cells(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook.getWorksheet("Phieu")!;
}

const catalog = templateFieldCatalog([{ key: "atld", name: "Thẻ an toàn" }]);

describe("placeFieldCodes / removeFieldCode", () => {
  it("ghi mã vào ô (ô gộp ghi vào ô chủ), giữ định dạng, điền sau chữ khi append", async () => {
    const bytes = await placeFieldCodes(await rawTemplate(), "Phieu", [
      { cell: "C1", field: "fullNameUpper" },
      { cell: "A2", field: "dob", mode: "append" },
      { cell: "A2", field: "dob", mode: "append" },
    ]);
    const sheet = await cells(bytes);
    expect(sheet.getCell("B1").value).toBe("{{fullNameUpper}}");
    expect((sheet.getCell("B1").fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFFF00");
    // Không ghi lặp mã đã có
    expect(sheet.getCell("A2").value).toBe("Ngày sinh: {{dob}}");
    expect(sheet.getCell("A2").font?.bold).toBe(true);
    expect((await scanTemplate(bytes)).placeholders).toEqual(["fullNameUpper", "dob"]);
  });

  it("gỡ mã: giữ phần chữ còn lại, ô chỉ có mã thì để trống; giới hạn theo vùng", async () => {
    const placed = await placeFieldCodes(await rawTemplate(), "Phieu", [{ cell: "B1", field: "dob" }, { cell: "A2", field: "dob", mode: "append" }]);
    const onlyB1 = await cells(await removeFieldCode(placed, "Phieu", "dob", "B1:D1"));
    expect(onlyB1.getCell("B1").value).toBeNull();
    expect(onlyB1.getCell("A2").value).toBe("Ngày sinh: {{dob}}");
    const all = await cells(await removeFieldCode(placed, "Phieu", "dob"));
    expect(all.getCell("A2").value).toBe("Ngày sinh:");
  });
});

describe("mergeAiTemplate", () => {
  it("lấy mã, vùng IMG_, vùng in từ file AI, ghi vào file gốc và giữ định dạng gốc", async () => {
    const original = await rawTemplate();
    // File "AI trả về": gõ mã, xóa mất nhãn A2, đổi màu ô (không được lấy), thêm tên vùng ảnh và vùng in
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(original.slice().buffer);
    const sheet = workbook.getWorksheet("Phieu")!;
    sheet.getCell("B1").value = "{{fullNameUpper}}";
    sheet.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    sheet.getCell("A2").value = "{{dob}}";
    sheet.getCell("C5").value = "{{cert:atld}}";
    sheet.getCell("C6").value = "{{soTheCongTruong}}";
    sheet.getCell("C7").value = "{{cert:khongCo}}";
    workbook.definedNames.add("'Phieu'!$E$2:$F$6", "IMG_photo3x4");
    workbook.definedNames.add("'Phieu'!$A$10:$B$11", "IMG_logoNhaThau");
    sheet.pageSetup.printArea = "A1:F20";
    const ai = new Uint8Array(await workbook.xlsx.writeBuffer());

    const merge = await mergeAiTemplate(original, ai, "Phieu", catalog);
    const result = await cells(merge.bytes);
    expect(result.getCell("B1").value).toBe("{{fullNameUpper}}");
    expect((result.getCell("B1").fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFFF00");
    // Nhãn bị AI xóa được giữ lại, mã điền phía sau
    expect(result.getCell("A2").value).toBe("Ngày sinh: {{dob}}");
    expect(merge.images).toEqual([{ field: "photo3x4", range: "E2:F6" }, { field: "logoNhaThau", range: "A10:B11" }]);
    expect(merge.printArea).toBe("A1:F20");
    // B1 là ô chủ của vùng gộp B1:D1: chỉ tính một lần
    expect(merge.cells.map((cell) => cell.address)).toEqual(["B1", "A2", "C5", "C6", "C7"]);
    expect(merge.newKeys).toEqual(["soTheCongTruong", "cert:khongCo"]);
    const messages = merge.problems.map((problem) => `${problem.level}: ${problem.message}`);
    expect(messages.some((message) => message.startsWith("warning") && message.includes("Ngày sinh:"))).toBe(true);
    expect(messages.some((message) => message.startsWith("error") && message.includes("cert:khongCo"))).toBe(true);
    expect(messages.some((message) => message.includes("IMG_logoNhaThau"))).toBe(true);
    expect((await scanTemplate(merge.bytes)).placeholders).toEqual(["fullNameUpper", "dob", "cert:atld", "soTheCongTruong", "cert:khongCo"]);
  });

  it("báo lỗi khi gửi nhầm file không có mã", async () => {
    const original = await rawTemplate();
    const merge = await mergeAiTemplate(original, original, "Phieu", catalog);
    expect(merge.problems[0]).toMatchObject({ level: "error" });
  });
});

describe("bộ quy tắc", () => {
  it("mọi mã của app đều có mô tả nhãn (thêm biến mới phải bổ sung FIELD_ALIASES)", () => {
    expect(fieldsWithoutAlias()).toEqual([]);
  });

  it("prompt liệt kê đủ mã, ảnh ghi bằng tên vùng IMG_, yêu cầu trả về file Excel", () => {
    const rules = buildMappingRules(catalog);
    for (const field of catalog) expect(rules).toContain(field.kind === "image" ? `\`IMG_${field.key}\`` : `\`{{${field.key}}}\``);
    expect(rules).toContain("hỏi lại");
    expect(rules).toContain("-da-gan-ma.xlsx");
  });
});
