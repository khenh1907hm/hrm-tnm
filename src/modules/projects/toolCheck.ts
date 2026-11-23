import ExcelJS from "exceljs";

/**
 * Kiểm tra dụng cụ, máy điện (mẫu "TOOL & MACHINE CHECK PHOTO REPORT", sheet Electrical tool & machine).
 * Dữ liệu do app điện thoại nhập (mobile/src/lib/toolCheck.ts); web xem và xuất Excel kèm ảnh.
 */
export const ITEM_KEYS = ["outlook", "earthing", "resistance", "function"] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];
export const ITEM_LABEL: Record<ItemKey, { en: string; vi: string }> = {
  outlook: { en: "Out look check", vi: "Bên ngoài" },
  earthing: { en: "Earthing connection (<0.3Ω)", vi: "Tiếp địa" },
  resistance: { en: "Resistance (≥2MΩ @ 500V)", vi: "Cách điện" },
  function: { en: "Functions test", vi: "Chạy thử" },
};

export type ToolCheckRow = { serial: string; subcon: string; typeName: string; items: ItemKey[]; photos: Partial<Record<ItemKey, string>>; result: "OK" | "NG"; note: string };
export type ToolCheck = { id: string; date: string; checkedBy: string; rows: ToolCheckRow[]; updatedAt: string };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function parseToolCheck(raw: Raw): ToolCheck {
  const rows = (Array.isArray(raw.rows) ? (raw.rows as Raw[]) : []).map((r): ToolCheckRow => {
    const photos: Partial<Record<ItemKey, string>> = {};
    const p = (r.photos ?? {}) as Raw;
    for (const key of ITEM_KEYS) if (p[key]) photos[key] = str(p[key]);
    const items = (Array.isArray(r.items) ? (r.items as unknown[]).map(String) : ["outlook"]).filter((k): k is ItemKey => (ITEM_KEYS as readonly string[]).includes(k));
    return { serial: str(r.serial), subcon: str(r.subcon), typeName: str(r.typeName), items: items.length ? items : ["outlook"], photos, result: r.result === "NG" ? "NG" : "OK", note: str(r.note) };
  });
  return { id: str(raw.id), date: str(raw.check_date), checkedBy: str(raw.checked_by), rows, updatedAt: str(raw.updated_at) };
}

export const photoCount = (check: ToolCheck) => check.rows.reduce((sum, r) => sum + Object.keys(r.photos).length, 0);
export const missingCount = (check: ToolCheck) => check.rows.reduce((sum, r) => sum + r.items.filter((k) => !r.photos[k]).length, 0);

/** Ảnh đã tải về (JPEG) kèm kích thước, theo đường dẫn trong bucket. */
export type LoadedImage = { buffer: ArrayBuffer; width: number; height: number };

const PHOTO_COL = { outlook: 4, earthing: 5, resistance: 6, function: 7 } as const satisfies Record<ItemKey, number>;
const COL_WIDTH = [2, 22, 10, 34, 34, 34, 34, 10, 24];
const ROW_PT = 150;
const px = (chars: number) => Math.floor(chars * 7 + 5);

/**
 * Xuất Excel theo mẫu TOOL & MACHINE CHECK PHOTO REPORT: mỗi dụng cụ một dòng, ảnh đặt giữa ô của từng mục,
 * mục không áp dụng cho loại đó ghi "N/A", Result OK / NG (có danh sách chọn), dòng NG tô đỏ.
 */
export async function buildToolCheckWorkbook(check: ToolCheck, project: { code: string; name: string }, images: ReadonlyMap<string, LoadedImage>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Electrical tool & machine", { pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, views: [{ showGridLines: false }] });
  COL_WIDTH.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { vertical: "middle" as const, horizontal: "center" as const, wrapText: true };

  ws.mergeCells("B2:H2");
  Object.assign(ws.getCell("B2"), { value: "TOOL & MACHINE CHECK PHOTO REPORT", font: { bold: true, size: 18 }, alignment: { horizontal: "center" } });
  ws.mergeCells("B3:H3");
  Object.assign(ws.getCell("B3"), { value: `Project: ${project.code} · ${project.name}`, font: { size: 11 }, alignment: { horizontal: "center" } });
  ws.getCell("D4").value = `Checked by: ${check.checkedBy}`;
  ws.getCell("F4").value = `Checking date: ${check.date.split("-").reverse().join("/")}`;
  ws.getRow(4).font = { bold: true, size: 12 };
  ws.getCell("B5").value = "Applied to 220/380V tool & machine. Consult AZ dept. for further information.";
  ws.getCell("B5").font = { italic: true, size: 10 };

  ws.mergeCells("B7:B8"); ws.mergeCells("C7:C8"); ws.mergeCells("D7:G7"); ws.mergeCells("H7:H8"); ws.mergeCells("I7:I8");
  ws.getCell("B7").value = "Serial/\nCode";
  ws.getCell("C7").value = "Sub con.";
  ws.getCell("D7").value = "Photo";
  ws.getCell("H7").value = "Result \n(OK/NG)";
  ws.getCell("I7").value = "Remark";
  for (const key of ITEM_KEYS) ws.getCell(8, PHOTO_COL[key]).value = ITEM_LABEL[key].en;
  for (const row of [7, 8]) for (let c = 2; c <= 9; c++) {
    const cell = ws.getCell(row, c);
    cell.border = box; cell.alignment = center; cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  }
  ws.getRow(7).height = 24; ws.getRow(8).height = 30;

  check.rows.forEach((item, index) => {
    const r = 9 + index;
    const row = ws.getRow(r);
    row.height = ROW_PT;
    row.getCell(2).value = item.serial;
    row.getCell(3).value = item.subcon;
    row.getCell(8).value = item.result;
    row.getCell(9).value = item.note || null;
    for (let c = 2; c <= 9; c++) { const cell = row.getCell(c); cell.border = box; cell.alignment = center; }
    row.getCell(2).font = { bold: true };
    row.getCell(8).font = { bold: true, color: { argb: item.result === "NG" ? "FFC00000" : "FF00703C" } };
    row.getCell(8).dataValidation = { type: "list", allowBlank: false, formulae: ['"OK,NG"'] };
    if (item.result === "NG") for (let c = 2; c <= 9; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4E4" } };

    for (const key of ITEM_KEYS) {
      const col = PHOTO_COL[key];
      if (!item.items.includes(key)) { row.getCell(col).value = "N/A"; row.getCell(col).font = { color: { argb: "FF999999" } }; continue; }
      const path = item.photos[key];
      const image = path ? images.get(path) : undefined;
      if (!image) { row.getCell(col).value = path ? "(photo not loaded)" : "No photo"; row.getCell(col).font = { color: { argb: "FFC00000" }, italic: true }; continue; }
      const boxW = px(COL_WIDTH[col - 1]!) - 8, boxH = Math.floor((ROW_PT * 4) / 3) - 8;
      const scale = Math.min(boxW / image.width, boxH / image.height);
      const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
      const id = wb.addImage({ buffer: image.buffer as ExcelJS.Buffer, extension: "jpeg" });
      // Đặt giữa ô: lệch theo phần lẻ của cột / dòng (ExcelJS tính col, row bắt đầu từ 0)
      ws.addImage(id, { tl: { col: col - 1 + (boxW + 8 - w) / 2 / px(COL_WIDTH[col - 1]!), row: r - 1 + (boxH + 8 - h) / 2 / ((ROW_PT * 4) / 3) } as ExcelJS.Anchor, ext: { width: w, height: h }, editAs: "oneCell" });
    }
  });

  const last = 9 + check.rows.length;
  const ok = check.rows.filter((r) => r.result === "OK").length;
  ws.getCell(last + 1, 2).value = `Total: ${check.rows.length} · OK: ${ok} · NG: ${check.rows.length - ok}`;
  ws.getCell(last + 1, 2).font = { bold: true };
  ws.pageSetup.printArea = `A1:I${last + 1}`;
  ws.pageSetup.printTitlesRow = "7:8";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
