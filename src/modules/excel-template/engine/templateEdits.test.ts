import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildMappingRules, parseMappingPlan } from "./mappingPlan";
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

describe("parseMappingPlan", () => {
  it("đọc khối JSON trong câu trả lời, giữ dòng hợp lệ, báo dòng sai", () => {
    const answer = `Đây là kết quả:\n\`\`\`json\n${JSON.stringify({
      sheet: "Phieu",
      printArea: "$A$1:$D$20",
      fields: [
        { cell: "b1", field: "fullNameUpper", mode: "replace" },
        { cell: "A2", field: "dob", mode: "append" },
        { cell: "C5", field: "cert:atld" },
        { cell: "C6", field: "khongCo" },
        { cell: "B1", field: "phone" },
        { cell: "Z99", field: "home" },
      ],
      images: [{ range: "E2:F6", field: "photo3x4" }, { range: "A1", field: "logo" }],
      customFields: [{ cell: "B9", label: "Ngày bắt đầu dự án", kind: "date" }],
    })}\n\`\`\``;
    const { plan, problems } = parseMappingPlan(answer, catalog);
    expect(plan).toMatchObject({ sheet: "Phieu", printArea: "A1:D20" });
    expect(plan!.fields).toEqual([
      { cell: "B1", field: "fullNameUpper", mode: "replace" },
      { cell: "A2", field: "dob", mode: "append" },
      { cell: "C5", field: "cert:atld", mode: "replace" },
      { cell: "Z99", field: "home", mode: "replace" },
    ]);
    expect(plan!.images).toEqual([{ range: "E2:F6", field: "photo3x4" }]);
    expect(plan!.customFields).toEqual([{ cell: "B9", label: "Ngày bắt đầu dự án", kind: "date" }]);
    const messages = problems.map((problem) => `${problem.level}: ${problem.message}`);
    expect(messages.some((message) => message.startsWith("error") && message.includes("khongCo"))).toBe(true);
    expect(messages.some((message) => message.startsWith("error") && message.includes("B1 bị gán hai lần"))).toBe(true);
    expect(messages.some((message) => message.startsWith("warning") && message.includes("Z99"))).toBe(true);
    expect(messages.some((message) => message.includes("logo"))).toBe(true);
  });

  it("báo lỗi khi không có JSON hoặc JSON hỏng", () => {
    expect(parseMappingPlan("chưa có gì", catalog).plan).toBeNull();
    expect(parseMappingPlan("{ fields: [", catalog).problems[0]!.level).toBe("error");
  });
});

describe("buildMappingRules", () => {
  it("liệt kê đủ mã trường hiện có của app, kể cả loại chứng chỉ", () => {
    const rules = buildMappingRules(catalog);
    for (const field of catalog) expect(rules).toContain(`\`${field.key}\``);
    expect(rules).toContain("hỏi lại");
  });
});
