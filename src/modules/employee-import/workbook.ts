import ExcelJS from "exceljs";
import { POSITIONS } from "../employees/types";
import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, plainCell, REQUIRED_IMPORT_FIELDS, type PlainCell } from "./parse";

export type SheetRows = { name: string; rows: PlainCell[][] };

/** Đọc mọi trang tính có dữ liệu thành mảng giá trị ô (giữ đúng vị trí cột). */
export async function readWorkbook(data: ArrayBuffer): Promise<SheetRows[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sheets: SheetRows[] = [];
  workbook.eachSheet((sheet) => {
    const rows: PlainCell[][] = [];
    for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const cells: PlainCell[] = [];
      for (let column = 1; column <= sheet.columnCount; column += 1) cells.push(plainCell(row.getCell(column).value));
      rows.push(cells);
    }
    if (rows.some((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""))) sheets.push({ name: sheet.name, rows });
  });
  return sheets;
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };

/** File mẫu: đúng tên cột hệ thống nhận, một dòng ví dụ và trang hướng dẫn. */
export async function buildImportTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Nhân sự");
  sheet.columns = IMPORT_FIELDS.map((field) => ({ header: IMPORT_FIELD_LABELS[field], key: field, width: field === "address" || field === "currentAddress" || field === "home" ? 32 : field === "name" ? 24 : 16 }));
  sheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = HEADER_FILL; });
  // CCCD và điện thoại để dạng chữ cho khỏi mất số 0 đầu
  for (const key of ["cccd", "phone"]) sheet.getColumn(key).numFmt = "@";
  sheet.addRow({ code: "TNM001", name: "Nguyễn Văn An", dob: "15/03/1990", gender: "Nam", cccd: "001090012345", phone: "0912345678", home: "Xã Đông Hưng, Tỉnh Thái Bình", address: "Phường Hà Đông, Thành phố Hà Nội", currentAddress: "", position: "Nhân viên hiện trường", group: 3, startDate: "01/06/2015", companyStartDate: "01/03/2019", status: "Đang làm", endDate: "" });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const guide = workbook.addWorksheet("Hướng dẫn");
  guide.columns = [{ width: 22 }, { width: 90 }];
  const lines: [string, string][] = [
    ["Cột bắt buộc", REQUIRED_IMPORT_FIELDS.map((field) => IMPORT_FIELD_LABELS[field]).join(", ")],
    ["Ngày", "Ghi dd/mm/yyyy (ví dụ 15/03/1990) hoặc dùng ô kiểu ngày của Excel. Không nhận dòng chỉ có năm sinh."],
    ["Mã NV", "TNM và 3 đến 5 chữ số, không trùng (ví dụ TNM001)."],
    ["Số CCCD", "12 chữ số. Nên để ô kiểu chữ (Text) để không mất số 0 đầu."],
    ["Giới tính", "Nam hoặc Nữ. Để trống thì hệ thống lấy theo số CCCD."],
    ["Chức danh", POSITIONS.join(", ")],
    ["Nhóm ATLĐ", "Số từ 1 đến 6, có thể để trống."],
    ["Ngày làm nghề", "Ngày bắt đầu làm nghề, dùng để tính kinh nghiệm. Ngày vào TNM không bắt buộc, không được trước ngày làm nghề."],
    ["Tình trạng", "Đang làm (mặc định khi để trống), Tạm nghỉ, Nghỉ việc. Nghỉ việc thì cần Ngày nghỉ việc."],
    ["Tên cột", "Có thể giữ tên cột trong file cũ (ví dụ “SĐT”, “Quê quán”, “Chức vụ”); hệ thống tự nhận."],
  ];
  for (const [key, value] of lines) guide.addRow([key, value]).getCell(1).font = { bold: true };
  guide.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** File báo lỗi: giữ nguyên các cột gốc, thêm cột "Lỗi cần sửa" để sửa rồi nhập lại. */
export async function buildErrorReport(headers: readonly string[], failures: readonly { rowNumber: number; cells: readonly string[]; messages: readonly string[] }[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dòng lỗi");
  const header = sheet.addRow(["Dòng trong file", ...headers, "Lỗi cần sửa"]);
  header.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = HEADER_FILL; });
  for (const failure of failures) {
    const row = sheet.addRow([failure.rowNumber, ...headers.map((_, index) => failure.cells[index] ?? ""), failure.messages.join("\n")]);
    const last = row.getCell(headers.length + 2);
    last.font = { color: { argb: "FF991B1B" } };
    last.alignment = { wrapText: true, vertical: "top" };
  }
  sheet.columns.forEach((column, index) => { column.width = index === 0 ? 10 : index === headers.length + 1 ? 60 : 18; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
