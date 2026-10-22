import ExcelJS from "exceljs";
import type { ImageExtension } from "./imageSize";

export type TemplateImage = { bytes: Uint8Array; extension: ImageExtension; width: number; height: number };
/**
 * Vùng ô đặt ảnh. "stretch" và "cover" phủ kín đúng 4 góc vùng ô ("cover" đã được cắt theo tỉ lệ vùng trước đó,
 * nên chỉ méo vài phần trăm khi Excel/LibreOffice tính độ rộng cột khác ước lượng); mặc định co vừa khung, giữ tỉ lệ, căn giữa.
 */
export type ImageSlot = { field: string; range: string; fit?: "contain" | "cover" | "stretch" };

/**
 * Độ rộng cột ra pixel theo cách Excel tính (chữ mặc định rộng 7px). Độ rộng lưu trong file đã gồm lề,
 * nên không cộng thêm. Cột chưa đặt độ rộng: dùng mặc định của trang tính, không có thì 64px như Excel.
 */
export function columnWidthPx(sheet: ExcelJS.Worksheet, col: number): number {
  const column = sheet.getColumn(col);
  if (column.hidden) return 0;
  const width = column.width ?? sheet.properties.defaultColWidth;
  return width === undefined ? 64 : Math.trunc(((256 * width + Math.trunc(128 / 7)) / 256) * 7);
}

/**
 * Vị trí cách mép đầu vùng `distance` pixel → tọa độ cột/dòng phân số (đếm từ 0) để neo ảnh.
 * Chạm đúng mép cuối vùng thì trả về đúng biên ô cuối (không làm tròn lệch sang ô bên cạnh).
 */
export function anchorAt(first: number, last: number, distance: number, sizePx: (index: number) => number): number {
  let remaining = Math.max(0, distance);
  for (let index = first; index <= last; index += 1) {
    const size = sizePx(index);
    if (remaining < size || index === last) return index - 1 + (size ? Math.min(1, remaining / size) : 0);
    remaining -= size;
  }
  return last;
}

/** Chiều cao dòng ra pixel (điểm × 96/72); dòng ẩn bằng 0. */
export function rowHeightPx(sheet: ExcelJS.Worksheet, row: number): number {
  const line = sheet.getRow(row);
  return line.hidden ? 0 : ((line.height ?? sheet.properties.defaultRowHeight ?? 15) * 96) / 72;
}
export type AttachmentPage = { title: string; image: TemplateImage };
export type FillWarning = { location: string; field: string };

export type FillWorkbookInput = {
  template: Uint8Array;
  sheetName?: string;
  /** Vùng in của phiếu (vd "B1:AZ73"); chiều cao vùng này là chiều cao một trang chứng chỉ. */
  printArea: string;
  values: Readonly<Record<string, string>>;
  imageSlots: readonly ImageSlot[];
  images: Readonly<Record<string, TemplateImage | null | undefined>>;
  attachments: readonly AttachmentPage[];
  /** Ghi thẳng giá trị vào ô (trường tự thêm, không có {{mã}} trong file); giữ nguyên định dạng ô. */
  cellValues?: readonly { address: string; field: string; value: string }[];
};

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const TITLE_ROW_PT = 20;
const IMAGE_ROW_PT = 12;

type CellRef = { col: number; row: number };

export function parseCellRef(address: string): CellRef {
  const match = /^([A-Z]{1,3})(\d+)$/.exec(address.trim().toUpperCase());
  if (!match) throw new Error(`Địa chỉ ô không hợp lệ: ${address}`);
  const col = [...match[1]!].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
  return { col, row: Number(match[2]) };
}

export function parseRange(range: string): [CellRef, CellRef] {
  const [start, end = start] = range.split(":");
  return [parseCellRef(start!), parseCellRef(end!)];
}

const columnLetter = (col: number): string => {
  let letters = "";
  for (let rest = col; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  return letters;
};

/** Điền mẫu: chỉ thay ô giữ chỗ {{truong}} và thêm ảnh; mọi định dạng khác giữ nguyên. */
export async function fillWorkbook(input: FillWorkbookInput): Promise<{ bytes: Uint8Array; warnings: FillWarning[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.template.slice().buffer);
  const sheet = (input.sheetName ? workbook.getWorksheet(input.sheetName) : undefined) ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Tệp mẫu không có sheet nào.");
  const warnings: FillWarning[] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (typeof cell.value !== "string" || !cell.value.includes("{{")) return;
    cell.value = cell.value.replace(PLACEHOLDER, (_, rawKey: string) => {
      const key = rawKey.trim();
      const value = input.values[key];
      if (!value) warnings.push({ location: cell.address, field: key });
      return value ?? "";
    });
  }));

  for (const item of input.cellValues ?? []) {
    const cell = sheet.getCell(item.address);
    const target = cell.isMerged ? cell.master : cell;
    target.value = item.value;
    if (!item.value) warnings.push({ location: target.address, field: item.field });
  }

  const columnPx = (col: number) => columnWidthPx(sheet, col);
  const rowPx = (row: number) => rowHeightPx(sheet, row);

  const placeImage = (image: TemplateImage, range: string, stretch: boolean) => {
    const [start, end] = parseRange(range);
    let width = 0;
    for (let col = start.col; col <= end.col; col += 1) width += columnPx(col);
    let height = 0;
    for (let row = start.row; row <= end.row; row += 1) height += rowPx(row);
    const scale = Math.min(width / image.width, height / image.height);
    const imageWidth = stretch ? width : image.width * scale;
    const imageHeight = stretch ? height : image.height * scale;
    // Neo cả hai góc theo ô (cột/dòng phân số, đếm từ 0) thay vì góc trên + kích thước pixel:
    // Excel/LibreOffice vẽ ảnh đúng từ góc này tới góc kia theo độ rộng cột thật của họ,
    // nên cạnh ảnh luôn trùng cạnh vùng ô dù ước lượng pixel ở đây lệch vài phần trăm.
    const left = (width - imageWidth) / 2;
    const top = (height - imageHeight) / 2;
    const imageId = workbook.addImage({ buffer: image.bytes.slice().buffer, extension: image.extension });
    sheet.addImage(imageId, {
      tl: { col: anchorAt(start.col, end.col, left, columnPx), row: anchorAt(start.row, end.row, top, rowPx) } as ExcelJS.Anchor,
      br: { col: anchorAt(start.col, end.col, left + imageWidth, columnPx), row: anchorAt(start.row, end.row, top + imageHeight, rowPx) } as ExcelJS.Anchor,
      editAs: "twoCell",
    });
  };

  for (const slot of input.imageSlots) {
    const image = input.images[slot.field];
    if (!image) { warnings.push({ location: slot.range, field: slot.field }); continue; }
    placeImage(image, slot.range, slot.fit === "stretch" || slot.fit === "cover");
  }

  const [printStart, printEnd] = parseRange(input.printArea);
  let pageHeightPt = 0;
  for (let row = printStart.row; row <= printEnd.row; row += 1) pageHeightPt += sheet.getRow(row).height ?? sheet.properties.defaultRowHeight ?? 15;
  const firstColumn = columnLetter(printStart.col);
  const lastColumn = columnLetter(printEnd.col);
  const imageRows = Math.max(1, Math.floor((pageHeightPt - TITLE_ROW_PT) / IMAGE_ROW_PT) - 1);
  let lastRow = printEnd.row;
  for (const page of input.attachments) {
    sheet.getRow(lastRow).addPageBreak();
    const titleRow = lastRow + 1;
    sheet.mergeCells(`${firstColumn}${titleRow}:${lastColumn}${titleRow}`);
    const title = sheet.getCell(`${firstColumn}${titleRow}`);
    title.value = page.title;
    title.font = { name: "Tahoma", size: 10, bold: true };
    title.alignment = { vertical: "middle" };
    sheet.getRow(titleRow).height = TITLE_ROW_PT;
    for (let row = titleRow + 1; row <= titleRow + imageRows; row += 1) sheet.getRow(row).height = IMAGE_ROW_PT;
    placeImage(page.image, `${firstColumn}${titleRow + 1}:${lastColumn}${titleRow + imageRows}`, false);
    lastRow = titleRow + imageRows;
  }
  sheet.pageSetup.printArea = `${firstColumn}${printStart.row}:${lastColumn}${lastRow}`;
  // exceljs ghi useFirstPageNumber theo firstPageNumber (luôn có sau khi đọc) → giữ đúng cờ gốc của mẫu
  if (!(sheet.pageSetup as { useFirstPageNumber?: boolean }).useFirstPageNumber) delete sheet.pageSetup.firstPageNumber;

  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), warnings };
}
