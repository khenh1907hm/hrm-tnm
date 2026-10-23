import ExcelJS from "exceljs";
import { columnWidthPx, expandMergedRange, parseRange, rowHeightPx } from "./fillWorkbook";

/** Hộp chữ nhật theo pixel, gốc là góc trên trái vùng in. */
export type PreviewBox = { x: number; y: number; width: number; height: number };
export type PreviewCell = PreviewBox & {
  address: string;
  text: string;
  bold: boolean;
  italic: boolean;
  /** Cỡ chữ theo pixel. */
  fontSize: number;
  color: string | null;
  fill: string | null;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  wrap: boolean;
  /** Viền trên, phải, dưới, trái có hay không. */
  border: [boolean, boolean, boolean, boolean];
  /** Các mã {{…}} trong ô. */
  placeholders: string[];
};
export type PreviewImage = PreviewBox & { src: string };
export type SheetPreview = {
  width: number;
  height: number;
  cells: PreviewCell[];
  images: PreviewImage[];
  /** Đổi một vùng ô (vd "E8:K16", ô gộp thì lấy cả khối) ra hộp pixel trên ảnh; ngoài vùng in thì null. */
  boxOf: (range: string) => PreviewBox | null;
  /** Vùng ô phủ hình chữ nhật kéo chuột (pixel trên ảnh), nới ra cho trọn các ô gộp; vd "E8" hoặc "E8:K16". */
  rangeAt: (x0: number, y0: number, x1: number, y1: number) => string;
};

/** Màu "theme" mặc định của Office (đủ cho bản xem trước; tint làm sáng/tối thêm). */
const THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
/** Một số màu "indexed" cũ hay gặp. */
const INDEXED: Readonly<Record<number, string>> = { 8: "000000", 9: "FFFFFF", 10: "FF0000", 12: "0000FF", 13: "FFFF00", 22: "C0C0C0", 23: "808080", 64: "000000" };

function toCss(color: Partial<ExcelJS.Color> & { indexed?: number; tint?: number } | undefined): string | null {
  if (!color) return null;
  let hex = color.argb ? color.argb.slice(-6) : color.theme !== undefined ? THEME[color.theme] : color.indexed !== undefined ? INDEXED[color.indexed] : undefined;
  if (!hex) return null;
  const tint = color.tint ?? 0;
  if (tint) {
    hex = [0, 2, 4].map((offset) => {
      const channel = parseInt(hex!.slice(offset, offset + 2), 16);
      const value = tint > 0 ? channel + (255 - channel) * tint : channel * (1 + tint);
      return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
    }).join("");
  }
  return `#${hex}`;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if (value instanceof Date) return value.toLocaleDateString("vi-VN");
    return "";
  }
  return String(value);
}

const columnName = (col: number) => {
  let name = "";
  for (let rest = col; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
};

/**
 * Dựng bản xem trước của vùng in trong sheet mẫu: vị trí, kích thước từng ô (theo cách Excel tính độ rộng cột),
 * chữ, màu nền, viền, ô gộp và ảnh có sẵn (logo…). Dùng để chỉ cho người cài mẫu thấy ô nào được điền gì.
 */
export async function buildSheetPreview(bytes: Uint8Array, sheetName: string | undefined, printArea: string): Promise<SheetPreview | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const sheet = (sheetName ? workbook.getWorksheet(sheetName) : undefined) ?? workbook.worksheets[0];
  if (!sheet) return null;
  let start: { col: number; row: number }, end: { col: number; row: number };
  try { [start, end] = parseRange(printArea.replace(/\$/g, "")); } catch { return null; }

  const colX = [0];
  for (let col = start.col; col <= end.col; col += 1) colX.push(colX[colX.length - 1]! + columnWidthPx(sheet, col));
  const rowY = [0];
  for (let row = start.row; row <= end.row; row += 1) rowY.push(rowY[rowY.length - 1]! + rowHeightPx(sheet, row));
  const inside = (col: number, row: number) => col >= start.col && col <= end.col && row >= start.row && row <= end.row;
  const box = (fromCol: number, fromRow: number, toCol: number, toRow: number): PreviewBox => {
    const c0 = Math.max(fromCol, start.col) - start.col, c1 = Math.min(toCol, end.col) - start.col + 1;
    const r0 = Math.max(fromRow, start.row) - start.row, r1 = Math.min(toRow, end.row) - start.row + 1;
    return { x: colX[c0]!, y: rowY[r0]!, width: colX[c1]! - colX[c0]!, height: rowY[r1]! - rowY[r0]! };
  };

  // Ô gộp: chỉ vẽ ô chủ, phủ cả khối
  const mergeOf = new Map<string, [number, number, number, number]>();
  const covered = new Set<string>();
  for (const merge of sheet.model.merges) {
    const [a, b] = parseRange(merge);
    mergeOf.set(`${a.col}:${a.row}`, [a.col, a.row, b.col, b.row]);
    for (let row = a.row; row <= b.row; row += 1) for (let col = a.col; col <= b.col; col += 1) if (row !== a.row || col !== a.col) covered.add(`${col}:${row}`);
  }

  const cells: PreviewCell[] = [];
  for (let row = start.row; row <= end.row; row += 1) {
    for (let col = start.col; col <= end.col; col += 1) {
      if (covered.has(`${col}:${row}`)) continue;
      const cell = sheet.getCell(row, col);
      const text = cellText(cell.value);
      const fill = cell.fill?.type === "pattern" && cell.fill.pattern === "solid" ? toCss(cell.fill.fgColor) : null;
      const border = cell.border ?? {};
      const edges: [boolean, boolean, boolean, boolean] = [Boolean(border.top?.style), Boolean(border.right?.style), Boolean(border.bottom?.style), Boolean(border.left?.style)];
      if (!text && (!fill || fill === "#ffffff" || fill === "#FFFFFF") && !edges.some(Boolean)) continue;
      const merge = mergeOf.get(`${col}:${row}`);
      const area = merge ? box(merge[0], merge[1], merge[2], merge[3]) : box(col, row, col, row);
      const horizontal = cell.alignment?.horizontal;
      cells.push({
        ...area,
        address: `${columnName(col)}${row}`,
        text,
        bold: Boolean(cell.font?.bold),
        italic: Boolean(cell.font?.italic),
        fontSize: ((cell.font?.size ?? 11) * 96) / 72,
        color: toCss(cell.font?.color),
        fill,
        align: horizontal === "center" || horizontal === "centerContinuous" ? "center" : horizontal === "right" ? "right" : "left",
        valign: cell.alignment?.vertical === "top" ? "top" : cell.alignment?.vertical === "bottom" || !cell.alignment?.vertical ? "bottom" : "middle",
        wrap: Boolean(cell.alignment?.wrapText),
        border: edges,
        placeholders: [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!),
      });
    }
  }

  // Ảnh có sẵn trong mẫu (logo, dấu…): neo hai góc theo ô
  const images: PreviewImage[] = [];
  const offsetX = (col: number) => { const index = Math.floor(col) - (start.col - 1); return (colX[Math.max(0, Math.min(colX.length - 1, index))] ?? 0) + (col % 1) * columnWidthPx(sheet, Math.floor(col) + 1); };
  const offsetY = (row: number) => { const index = Math.floor(row) - (start.row - 1); return (rowY[Math.max(0, Math.min(rowY.length - 1, index))] ?? 0) + (row % 1) * rowHeightPx(sheet, Math.floor(row) + 1); };
  for (const image of sheet.getImages()) {
    const media = workbook.getImage(Number(image.imageId));
    const tl = image.range.tl, br = image.range.br;
    if (!media?.buffer || !tl || !br) continue;
    const base64 = typeof window === "undefined" ? Buffer.from(media.buffer as ArrayBuffer).toString("base64") : btoa(Array.from(new Uint8Array(media.buffer as ArrayBuffer), (byte) => String.fromCharCode(byte)).join(""));
    const x = offsetX(tl.col), y = offsetY(tl.row);
    images.push({ x, y, width: Math.max(1, offsetX(br.col) - x), height: Math.max(1, offsetY(br.row) - y), src: `data:image/${media.extension === "jpeg" ? "jpeg" : media.extension};base64,${base64}` });
  }

  return {
    width: colX[colX.length - 1]!,
    height: rowY[rowY.length - 1]!,
    cells,
    images,
    rangeAt(x0, y0, x1, y1) {
      const index = (edges: number[], value: number) => { let i = 0; while (i < edges.length - 2 && edges[i + 1]! <= value) i += 1; return i; };
      let c0 = start.col + index(colX, Math.min(x0, x1)), c1 = start.col + index(colX, Math.max(x0, x1));
      let r0 = start.row + index(rowY, Math.min(y0, y1)), r1 = start.row + index(rowY, Math.max(y0, y1));
      // Nới vùng chọn cho trọn mọi ô gộp chạm vào (lặp vì nới ra có thể chạm thêm ô gộp khác)
      for (let changed = true; changed;) {
        changed = false;
        for (const [a0, b0, a1, b1] of mergeOf.values()) {
          if (a1 < c0 || a0 > c1 || b1 < r0 || b0 > r1) continue;
          if (a0 < c0 || a1 > c1 || b0 < r0 || b1 > r1) { c0 = Math.min(c0, a0); c1 = Math.max(c1, a1); r0 = Math.min(r0, b0); r1 = Math.max(r1, b1); changed = true; }
        }
      }
      const from = `${columnName(c0)}${r0}`, to = `${columnName(c1)}${r1}`;
      return from === to || mergeOf.get(`${c0}:${r0}`)?.join() === [c0, r0, c1, r1].join() ? from : `${from}:${to}`;
    },
    boxOf(range) {
      try {
        const [a, b] = parseRange(expandMergedRange(sheet, range.trim().toUpperCase().replace(/\$/g, "")));
        if (!inside(a.col, a.row) && !inside(b.col, b.row)) return null;
        return box(Math.min(a.col, b.col), Math.min(a.row, b.row), Math.max(a.col, b.col), Math.max(a.row, b.row));
      } catch { return null; }
    },
  };
}
