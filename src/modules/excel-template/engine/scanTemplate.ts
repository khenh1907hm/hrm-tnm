import ExcelJS from "exceljs";
import { columnWidthPx, parseRange, rowHeightPx, type ImageSlot } from "./fillWorkbook";

export const IMAGE_SLOT_PREFIX = "IMG_";

export type TemplateScan = {
  sheetName: string;
  /** Khóa trong {{...}}, theo thứ tự xuất hiện, không trùng. */
  placeholders: string[];
  printArea: string | null;
  /** Vùng ảnh khai báo bằng tên vùng IMG_<trường> trong Excel. */
  imageSlots: ImageSlot[];
  /** Tỉ lệ rộng/cao (theo pixel) của từng vùng ảnh, dùng để cắt ảnh "lấp đầy". */
  slotAspect: Record<string, number>;
};

const stripRange = (value: string) => value.replace(/^.*!/, "").replace(/\$/g, "");

/** Đọc mẫu: tìm sheet có ô giữ chỗ, các khóa trường, vùng in và vùng ảnh. */
export async function scanTemplate(template: Uint8Array): Promise<TemplateScan> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template.slice().buffer);
  const placeholdersBySheet = workbook.worksheets.map((sheet) => {
    const keys: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value !== "string") return;
      for (const match of cell.value.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const key = match[1]!.trim();
        if (!keys.includes(key)) keys.push(key);
      }
    }));
    return { sheet, keys };
  });
  const chosen = placeholdersBySheet.find((item) => item.keys.length) ?? placeholdersBySheet[0];
  if (!chosen) throw new Error("Tệp mẫu không có sheet nào.");
  const { sheet } = chosen;

  const imageSlots = workbook.definedNames.model
    .filter((item) => item.name.toUpperCase().startsWith(IMAGE_SLOT_PREFIX) && item.ranges[0])
    .map((item) => ({ field: item.name.slice(IMAGE_SLOT_PREFIX.length), range: stripRange(item.ranges[0]!) }));

  const columnPx = (col: number) => columnWidthPx(sheet, col);
  const rowPx = (row: number) => rowHeightPx(sheet, row);
  const slotAspect: Record<string, number> = {};
  for (const slot of imageSlots) {
    const [start, end] = parseRange(slot.range);
    let width = 0;
    for (let col = start.col; col <= end.col; col += 1) width += columnPx(col);
    let height = 0;
    for (let row = start.row; row <= end.row; row += 1) height += rowPx(row);
    slotAspect[slot.field] = width / height;
  }

  const printArea = sheet.pageSetup.printArea ? stripRange(sheet.pageSetup.printArea.split(",")[0]!) : null;
  return { sheetName: sheet.name, placeholders: chosen.keys, printArea, imageSlots, slotAspect };
}
