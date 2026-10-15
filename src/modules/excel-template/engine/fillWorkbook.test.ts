import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fillWorkbook, parseCellRef, parseRange, type TemplateImage } from "./fillWorkbook";

/** PNG RGB một màu, đủ để Excel nhúng như ảnh thật. */
function solidPng(width: number, height: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (data: Buffer) => { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 200);
  for (let y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const image = (width: number, height: number): TemplateImage => ({ bytes: solidPng(width, height), extension: "png", width, height });

const BORDER: Partial<ExcelJS.Borders> = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "medium", color: { argb: "FF1F3F5E" } } };

/** Mẫu giống phiếu thật: ô gộp, cột/dòng tùy chỉnh, viền, nền, logo, thiết lập in và ô giữ chỗ. */
async function buildTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Ghi chu");
  const sheet = workbook.addWorksheet("Phieu");
  sheet.columns = [{ width: 4 }, { width: 18 }, { width: 26 }, {}, { width: 12 }, { width: 12 }];
  for (let row = 1; row <= 20; row += 1) if (row % 3) sheet.getRow(row).height = 18 + row;
  sheet.mergeCells("A1:F2");
  sheet.getCell("A1").value = "WORKER PROFILE / BẢN THÔNG TIN VỀ CÔNG NHÂN";
  sheet.getCell("A1").font = { name: "Tahoma", size: 14, bold: true, color: { argb: "FF1F3F5E" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  const cells: Record<string, string> = { B5: "Họ và tên:", C5: "{{fullNameUpper}}", B6: "Ngày ký:", C6: "Date/Ngày:  {{exportDate}}", B7: "Ghi chú:", C7: "{{missingField}}", B8: "An toàn lao động", A8: "{{ cert:atld }}", C9: "Ô thường không đổi" };
  for (const [address, value] of Object.entries(cells)) {
    const cell = sheet.getCell(address);
    cell.value = value;
    cell.font = { name: "Tahoma", size: 9, italic: address.startsWith("B") };
    cell.border = BORDER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: address.startsWith("B") ? "FFFFF2CC" : "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  }
  sheet.mergeCells("D4:F8");
  sheet.getCell("C10").numFmt = "dd/mm/yyyy";
  sheet.getCell("C10").value = 12345;
  const logo = workbook.addImage({ buffer: solidPng(40, 20).slice().buffer, extension: "png" });
  sheet.addImage(logo, { tl: { col: 0.2, row: 0.2 } as ExcelJS.Anchor, ext: { width: 40, height: 20 } });
  sheet.pageSetup = { paperSize: 9, orientation: "portrait", scale: 90, margins: { left: 0.24, right: 0.16, top: 0.24, bottom: 0.38, header: 0.24, footer: 0.17 }, printArea: "A1:F20" };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function open(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook.getWorksheet("Phieu")!;
}

const canonical = (value: unknown): unknown => value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const styleOf = (cell: ExcelJS.Cell) => JSON.stringify(canonical({ font: cell.font, border: cell.border, fill: cell.fill, alignment: cell.alignment, numFmt: cell.numFmt }));

describe("fillWorkbook", () => {
  it("keeps every format of the template and only replaces placeholder cells", async () => {
    const template = await buildTemplate();
    const { bytes, warnings } = await fillWorkbook({
      template, sheetName: "Phieu", printArea: "A1:F20",
      values: { fullNameUpper: "NGUYỄN MINH AN", exportDate: "14/10/2026", "cert:atld": "☑" },
      imageSlots: [{ field: "photo3x4", range: "D4:F8" }], images: { photo3x4: image(300, 400) }, attachments: [],
    });
    const before = await open(template);
    const after = await open(bytes);

    for (let row = 1; row <= 20; row += 1) {
      expect(after.getRow(row).height).toBe(before.getRow(row).height);
      for (let col = 1; col <= 6; col += 1) expect(styleOf(after.getCell(row, col))).toBe(styleOf(before.getCell(row, col)));
    }
    expect(after.columns.map((column) => column.width)).toEqual(before.columns.map((column) => column.width));
    expect(Object.keys((after as unknown as { _merges: object })._merges).sort()).toEqual(Object.keys((before as unknown as { _merges: object })._merges).sort());
    expect({ ...after.pageSetup, printArea: undefined }).toEqual({ ...before.pageSetup, printArea: undefined });
    expect(after.pageSetup.printArea).toBe("A1:F20");

    expect(after.getCell("C5").value).toBe("NGUYỄN MINH AN");
    expect(after.getCell("C6").value).toBe("Date/Ngày:  14/10/2026");
    expect(after.getCell("A8").value).toBe("☑");
    expect(after.getCell("C7").value).toBe("");
    expect(after.getCell("C9").value).toBe("Ô thường không đổi");
    expect(after.getCell("C10").value).toEqual(before.getCell("C10").value);
    expect(after.getCell("A1").value).toBe(before.getCell("A1").value);
    expect(warnings).toEqual([{ location: "C7", field: "missingField" }]);
  });

  it("fits images inside their slot, keeps the logo and warns about missing images", async () => {
    const { bytes, warnings } = await fillWorkbook({
      template: await buildTemplate(), sheetName: "Phieu", printArea: "A1:F20", values: {},
      imageSlots: [{ field: "photo3x4", range: "D4:F8" }, { field: "wide", range: "B12:F13" }, { field: "cccdImage", range: "B14:C18" }],
      images: { photo3x4: image(300, 400), wide: image(1000, 100), cccdImage: null }, attachments: [],
    });
    const images = (await open(bytes)).getImages();
    expect(images).toHaveLength(3);
    const photo = images.find((item) => item.range.tl.row >= 3 && item.range.tl.row < 8)!;
    expect(photo.range.tl.col).toBeGreaterThanOrEqual(3);
    expect(photo.range.tl.col).toBeLessThan(6);
    const wide = images.find((item) => item.range.tl.row >= 11)!;
    expect(wide.range.tl.col).toBeGreaterThanOrEqual(1);
    expect(wide.range.tl.row).toBeGreaterThan(11);
    expect(warnings).toEqual([{ location: "C7", field: "missingField" }, { location: "A8", field: "cert:atld" }, { location: "C5", field: "fullNameUpper" }, { location: "C6", field: "exportDate" }, { location: "B14:C18", field: "cccdImage" }].sort((a, b) => warnings.findIndex((w) => w.location === a.location) - warnings.findIndex((w) => w.location === b.location)));
  });

  it("appends one printed page per attachment below the form, in the given order", async () => {
    const { bytes } = await fillWorkbook({
      template: await buildTemplate(), printArea: "A1:F20", sheetName: "Khong co", values: {}, imageSlots: [], images: {},
      attachments: [{ title: "An toàn lao động · Số ATLD-01", image: image(1100, 760) }, { title: "Khám sức khỏe · Số KSK-02", image: image(760, 1100) }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.slice().buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe("Ghi chu");
    const zip = await JSZip.loadAsync(bytes);
    const sheetXml = await zip.file(Object.keys(zip.files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name) && name.endsWith("1.xml"))!)!.async("string");
    const breaks = [...sheetXml.matchAll(/<brk id="(\d+)"/g)].map((match) => Number(match[1]));
    expect(breaks[0]).toBe(20);
    expect(breaks).toHaveLength(2);
    expect(sheet.getCell(`A${breaks[0]! + 1}`).value).toBe("An toàn lao động · Số ATLD-01");
    expect(sheet.getCell(`A${breaks[1]! + 1}`).value).toBe("Khám sức khỏe · Số KSK-02");
    expect(sheet.getCell(`A${breaks[1]! + 1}`).font.bold).toBe(true);
    expect(sheet.pageSetup.printArea).toMatch(/^A1:F\d+$/);
    expect(Number(sheet.pageSetup.printArea!.split(":F")[1])).toBeGreaterThan(breaks[1]!);
    expect(sheet.getImages()).toHaveLength(2);
  });

  it("writes custom field values straight into target cells, keeping their format", async () => {
    const template = await buildTemplate();
    const { bytes, warnings } = await fillWorkbook({
      template, sheetName: "Phieu", printArea: "A1:F20", values: { fullNameUpper: "A", exportDate: "B", "cert:atld": "☑", missingField: "x" },
      imageSlots: [], images: {}, attachments: [],
      cellValues: [{ address: "C9", field: "contractor", value: "Thiên Nhật Minh" }, { address: "B10", field: "badgeNo", value: "" }, { address: "E4", field: "merged", value: "Gộp" }],
    });
    const before = await open(template);
    const after = await open(bytes);
    expect(after.getCell("C9").value).toBe("Thiên Nhật Minh");
    expect(styleOf(after.getCell("C9"))).toBe(styleOf(before.getCell("C9")));
    expect(after.getCell("D4").value).toBe("Gộp");
    expect(warnings).toEqual([{ location: "B10", field: "badgeNo" }]);
  });

  it("rejects a template without any sheet", async () => {
    const empty = new ExcelJS.Workbook();
    await expect(fillWorkbook({ template: new Uint8Array(await empty.xlsx.writeBuffer()), printArea: "A1:B2", values: {}, imageSlots: [], images: {}, attachments: [] })).rejects.toThrow("không có sheet");
  });
});

describe("cell references", () => {
  it("parses cells and ranges", () => {
    expect(parseCellRef("ab26")).toEqual({ col: 28, row: 26 });
    expect(parseRange("E8:K16")).toEqual([{ col: 5, row: 8 }, { col: 11, row: 16 }]);
    expect(parseRange("C19")).toEqual([{ col: 3, row: 19 }, { col: 3, row: 19 }]);
    expect(() => parseCellRef("8E")).toThrow("Địa chỉ ô không hợp lệ");
  });
});
