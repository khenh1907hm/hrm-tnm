"use client";
import type { SheetCell } from "../../../lib/xlsReader";
import { parseMaterialGrid, type ImportedMaterial } from "../../../modules/purchases/materialImport";

/** Trang tính đầu tiên của file .xls / .xlsx thành bảng ô (chỉ giá trị). */
async function readGrid(file: File): Promise<SheetCell[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if (isOle) return (await import("../../../lib/xlsReader")).readXlsFirstSheet(bytes);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("Chỉ nhận file Excel (.xls hoặc .xlsx) theo mẫu P-COST-08.");
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.slice().buffer);
  const sheet = book.worksheets[0];
  if (!sheet) return [];
  const grid: SheetCell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const line: SheetCell[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const value = cell.value as unknown;
      let out: SheetCell = null;
      if (typeof value === "number" || typeof value === "string") out = value;
      else if (value instanceof Date) out = value.toISOString().slice(0, 10);
      else if (value && typeof value === "object") {
        const record = value as { result?: unknown; richText?: { text: string }[]; text?: unknown };
        if (record.richText) out = record.richText.map((part) => part.text).join("");
        else if (record.result instanceof Date) out = record.result.toISOString().slice(0, 10);
        else if (typeof record.result === "number" || typeof record.result === "string") out = record.result;
        else if (typeof record.text === "string") out = record.text;
      }
      line[col - 1] = out;
    });
    grid[rowNumber - 1] = Array.from({ length: line.length }, (_, index) => line[index] ?? null);
  });
  return Array.from({ length: grid.length }, (_, index) => grid[index] ?? []);
}

export async function readMaterialFile(file: File): Promise<ImportedMaterial> {
  if (file.size > 10 * 1024 * 1024) throw new Error("File lớn hơn 10 MB.");
  try {
    return parseMaterialGrid(await readGrid(file));
  } catch (error) {
    if (error instanceof Error && error.message === "MR_IMPORT_NO_HEADER") throw new Error("Không tìm thấy bảng vật tư (dòng tiêu đề có “Tên vật tư” và “Số lượng”). Dùng đúng mẫu P-COST-08.");
    if (error instanceof Error && /^XLS_/.test(error.message)) throw new Error("File .xls bị lỗi hoặc không phải file Excel.");
    throw error;
  }
}
