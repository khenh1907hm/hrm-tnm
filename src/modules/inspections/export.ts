import ExcelJS from "exceljs";
import type { Inspection } from "./types";

/**
 * Xuất Báo cáo công trình theo mẫu "QHSE PHOTO REPORT" (Báo cáo Ban Giám Đốc kiểm tra công trình):
 * đầu phiếu (dự án, ngày kiểm tra, người báo cáo, gửi tới, CC, điểm kiểm tra quan trọng), mỗi lỗi một khối
 * Before (vị trí, giờ, vấn đề, cách giải quyết, hạn) | After (người phụ trách, comment, ngày hoàn thành).
 */
export type BurnedPhoto = { bytes: Uint8Array; width: number; height: number };
export type InspectionExportInput = {
  inspection: Inspection; project: { code: string; name: string };
  /** Ảnh đã in nét khoanh, theo id lỗi. */
  photos: Record<string, { before?: BurnedPhoto | undefined; after?: BurnedPhoto | undefined }>;
};

const COLS = 31; // A..AE
const col = (index: number) => { let n = index, out = ""; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };
const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const thin = { style: "thin" as const };

export async function buildInspectionWorkbook(input: InspectionExportInput): Promise<Uint8Array> {
  const { inspection, project } = input;
  const book = new ExcelJS.Workbook();
  book.creator = "Quản trị Online TNM";
  const ws = book.addWorksheet("QHSE photo report", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } } });
  ws.columns = Array.from({ length: COLS }, (_, index) => ({ width: index === 0 ? 3 : 3.4 }));
  const merge = (range: string) => { try { ws.mergeCells(range); } catch { /* đã gộp */ } };
  const put = (address: string, value: ExcelJS.CellValue, style: Partial<ExcelJS.Style> = {}) => { const cell = ws.getCell(address); cell.value = value; Object.assign(cell, style); return cell; };

  merge("G2:Y2");
  put("G2", "QHSE PHOTO REPORT", { font: { bold: true, size: 18 }, alignment: { horizontal: "center" } });
  const head = (row: number, label: string, value: string, labelRight: string, valueRight: string) => {
    merge(`B${row}:E${row}`); merge(`F${row}:O${row}`); merge(`Q${row}:T${row}`); merge(`U${row}:AD${row}`);
    put(`B${row}`, label, { font: { bold: true } });
    put(`F${row}`, value, { border: { bottom: thin } });
    put(`Q${row}`, labelRight, { font: { bold: true } });
    put(`U${row}`, valueRight, { border: { bottom: thin } });
  };
  head(4, "Project / Dept.:", `${project.code} ${project.name}`.trim(), "Check date:", dmy(inspection.checkDate));
  head(5, "Reported by:", inspection.reporterName, "Attention to:", inspection.attentionName);
  head(6, "CC:", inspection.cc, "Số phiếu:", inspection.number);
  put("B8", "Important check points for daily patrol:", { font: { bold: true, italic: true } });
  ["Important work following approved IW P&RA and daily schedule", "Site safety overall: walkway, barricade, signs, safety board", "Work method statement & installation check-sheet with site.", "Conditions (4M + E) for next working day plan."]
    .forEach((text, index) => { merge(`F${9 + index}:AD${9 + index}`); put(`C${9 + index}`, "PM"); put(`E${9 + index}`, "→"); put(`F${9 + index}`, text); });
  merge("A14:AE14");
  put("A14", "Hình ảnh ban giám đốc kiểm tra công trình.", { font: { bold: true, size: 12 }, alignment: { horizontal: "center" } });

  let row = 15;
  const photoRows = 10, photoHeight = 20;
  inspection.items.forEach((item, index) => {
    merge(`A${row}:AE${row}`);
    put(`A${row}`, `Defect number: …${index + 1}…`, { font: { bold: true }, alignment: { horizontal: "center" } });
    row += 1;
    merge(`B${row}:O${row}`); merge(`Q${row}:AD${row}`);
    put(`B${row}`, "Before", { font: { bold: true }, alignment: { horizontal: "center" }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } } });
    put(`Q${row}`, "After", { font: { bold: true }, alignment: { horizontal: "center" }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } } });
    row += 1;
    const top = row;
    for (let r = 0; r < photoRows; r += 1) ws.getRow(row + r).height = photoHeight;
    merge(`B${top}:O${top + photoRows - 1}`); merge(`Q${top}:AD${top + photoRows - 1}`);
    for (const start of ["B", "Q"]) ws.getCell(`${start}${top}`).border = { top: thin, left: thin, bottom: thin, right: thin };
    // Ảnh vừa khung (giữ tỉ lệ), canh giữa
    const place = (photo: BurnedPhoto | undefined, firstCol: number) => {
      if (!photo) return;
      const boxW = 14 * 3.4 * 7.0, boxH = photoRows * photoHeight * (96 / 72);
      const scale = Math.min(boxW / photo.width, boxH / photo.height);
      const width = Math.round(photo.width * scale), height = Math.round(photo.height * scale);
      const id = book.addImage({ buffer: photo.bytes.slice().buffer as ArrayBuffer, extension: "jpeg" });
      const colOffset = ((boxW - width) / 2) / (3.4 * 7.0);
      const rowOffset = ((boxH - height) / 2) / (photoHeight * (96 / 72));
      ws.addImage(id, { tl: { col: firstCol - 1 + colOffset, row: top - 1 + rowOffset }, ext: { width, height }, editAs: "oneCell" });
    };
    place(input.photos[item.id]?.before, 2);
    place(input.photos[item.id]?.after, 17);
    row = top + photoRows;
    merge(`D${row}:H${row}`); merge(`K${row}:O${row}`); merge(`Q${row}:AD${row}`);
    put(`B${row}`, "Location:", { font: { bold: true } }); put(`D${row}`, item.location);
    put(`I${row}`, "Time:", { font: { bold: true } }); put(`K${row}`, item.foundTime);
    put(`Q${row}`, `Person in charge (name and sign): ${item.fixedByName || inspection.attentionName}`);
    row += 1;
    put(`B${row}`, "Problem:", { font: { bold: true } });
    row += 1;
    merge(`B${row}:O${row}`); merge(`Q${row}:AD${row}`);
    ws.getRow(row).height = 32;
    put(`B${row}`, item.problem, { alignment: { wrapText: true, vertical: "top" } });
    put(`Q${row}`, "Comment:", { font: { bold: true }, alignment: { vertical: "top" } });
    row += 1;
    merge(`Q${row}:AD${row + 1}`);
    put(`B${row}`, "Countermeasure:", { font: { bold: true } });
    put(`Q${row}`, item.comment, { alignment: { wrapText: true, vertical: "top" } });
    row += 1;
    merge(`B${row}:O${row}`);
    ws.getRow(row).height = 32;
    put(`B${row}`, item.countermeasure, { alignment: { wrapText: true, vertical: "top" } });
    row += 1;
    merge(`B${row}:D${row}`); merge(`E${row}:H${row}`); merge(`Q${row}:S${row}`); merge(`T${row}:W${row}`);
    put(`B${row}`, "Target time:", { font: { bold: true } }); put(`E${row}`, dmy(item.targetDate));
    put(`Q${row}`, "Finish time:", { font: { bold: true } }); put(`T${row}`, dmy(item.finishDate));
    row += 2;
  });
  ws.pageSetup.printArea = `A1:${col(COLS)}${row}`;
  return new Uint8Array(await book.xlsx.writeBuffer());
}
