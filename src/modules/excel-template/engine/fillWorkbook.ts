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
  /** Vùng in của phiếu (vd "B1:AZ73"); khi xuất luôn được thu vừa đúng 1 trang. */
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
/**
 * Trang chứng chỉ chia nhiều cột hẹp thay vì một cột rộng: ExcelJS đổi phần lẻ trong một ô ra độ lệch theo đơn vị
 * nhỏ hơn thực tế nhiều lần, cột càng rộng ảnh càng lệch; cột hẹp thì sai số chỉ trong vài pixel.
 */
const ATTACHMENT_COLUMNS = 40;
/** Khổ giấy theo mã paperSize của Excel (điểm, dọc): 9 = A4, 1 = Letter. */
const PAPER_PT: Readonly<Record<number, [number, number]>> = { 1: [612, 792], 9: [595.28, 841.89] };

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

/** Vùng ảnh khai báo một ô đã gộp (vd IMG_ đặt trên E8 của khối gộp E8:K16) → dùng cả khối gộp. */
export function expandMergedRange(sheet: ExcelJS.Worksheet, range: string): string {
  if (range.includes(":")) return range;
  const address = range.trim().toUpperCase();
  return sheet.model.merges.find((merge) => merge.toUpperCase().startsWith(`${address}:`)) ?? range;
}

/**
 * Vùng in để ExcelJS ghi ra đúng dạng tuyệt đối. ExcelJS chỉ thêm "$" trước mỗi nửa vùng ("B1:AZ73" → "$B1:$AZ73");
 * Excel vẫn hiểu nhưng LibreOffice và các web đổi sang PDF đọc sai, in cả ô ngoài vùng → tràn trang, cắt đôi chữ ký.
 * Đưa "B$1:AZ$73" để file ghi ra "$B$1:$AZ$73".
 */
export function absolutePrintArea(range: string): string {
  return range.split(":").map((part) => part.replace(/^\$?([A-Z]+)\$?(\d+)$/i, (_, col: string, row: string) => `${col.toUpperCase()}$${row}`)).join(":");
}

/** Thu cả vùng in vào đúng 1 trang khi in / đổi sang PDF, dù phần mềm tính font, độ rộng cột lệch so với Excel. */
function fitToOnePage(sheet: ExcelJS.Worksheet) {
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 1;
}

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

  const placeImage = (target: ExcelJS.Worksheet, image: TemplateImage, range: string, stretch: boolean) => {
    const columnPx = (col: number) => columnWidthPx(target, col);
    const rowPx = (row: number) => rowHeightPx(target, row);
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
    target.addImage(imageId, {
      tl: { col: anchorAt(start.col, end.col, left, columnPx), row: anchorAt(start.row, end.row, top, rowPx) } as ExcelJS.Anchor,
      br: { col: anchorAt(start.col, end.col, left + imageWidth, columnPx), row: anchorAt(start.row, end.row, top + imageHeight, rowPx) } as ExcelJS.Anchor,
      editAs: "twoCell",
    });
  };

  for (const slot of input.imageSlots) {
    const image = input.images[slot.field];
    if (!image) { warnings.push({ location: slot.range, field: slot.field }); continue; }
    placeImage(sheet, image, expandMergedRange(sheet, slot.range), slot.fit === "stretch" || slot.fit === "cover");
  }

  sheet.pageSetup.printArea = absolutePrintArea(input.printArea);
  fitToOnePage(sheet);

  // Mỗi chứng chỉ một sheet riêng, cũng vừa đúng 1 trang (cùng khổ giấy, lề với phiếu). Không nối dưới phiếu bằng
  // ngắt trang được: khi đã thu vừa 1 trang, Excel bỏ qua ngắt trang thủ công và ép cả chứng chỉ vào trang phiếu.
  const { margins, paperSize, orientation } = sheet.pageSetup;
  const [paperWidth, paperHeight] = PAPER_PT[paperSize ?? 9] ?? PAPER_PT[9]!;
  const [pageWidth, pageHeight] = orientation === "landscape" ? [paperHeight, paperWidth] : [paperWidth, paperHeight];
  const printableWidth = pageWidth - ((margins?.left ?? 0.7) + (margins?.right ?? 0.7)) * 72;
  const printableHeight = pageHeight - ((margins?.top ?? 0.75) + (margins?.bottom ?? 0.75)) * 72;
  input.attachments.forEach((page, index) => {
    const attachment = workbook.addWorksheet(`Chứng chỉ ${index + 1}`, { properties: { defaultRowHeight: IMAGE_ROW_PT }, views: [{ showGridLines: false }] });
    // Các cột cộng lại rộng đúng khổ in (điểm → ký tự theo 7px/ký tự của Excel), số dòng ảnh lấp hết chiều cao trang
    for (let col = 1; col <= ATTACHMENT_COLUMNS; col += 1) attachment.getColumn(col).width = (printableWidth * 96) / 72 / ATTACHMENT_COLUMNS / 7;
    const lastColumn = attachment.getColumn(ATTACHMENT_COLUMNS).letter;
    const imageRows = Math.max(1, Math.floor((printableHeight - TITLE_ROW_PT) / IMAGE_ROW_PT) - 1);
    attachment.mergeCells(`A1:${lastColumn}1`);
    const title = attachment.getCell("A1");
    title.value = page.title;
    title.font = { name: "Tahoma", size: 10, bold: true };
    title.alignment = { vertical: "middle" };
    attachment.getRow(1).height = TITLE_ROW_PT;
    for (let row = 2; row <= imageRows + 1; row += 1) attachment.getRow(row).height = IMAGE_ROW_PT;
    placeImage(attachment, page.image, `A2:${lastColumn}${imageRows + 1}`, false);
    attachment.pageSetup = { paperSize: paperSize ?? 9, orientation: orientation ?? "portrait", ...(margins ? { margins } : {}), horizontalCentered: true, printArea: absolutePrintArea(`A1:${lastColumn}${imageRows + 1}`) };
    fitToOnePage(attachment);
  });
  // exceljs ghi useFirstPageNumber theo firstPageNumber (luôn có sau khi đọc) → giữ đúng cờ gốc của mẫu
  if (!(sheet.pageSetup as { useFirstPageNumber?: boolean }).useFirstPageNumber) delete sheet.pageSetup.firstPageNumber;

  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), warnings };
}
