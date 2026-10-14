import ExcelJS from "exceljs";
import {
  type ExcelCellMapping,
  isValidCellAddress,
  normalizeCellAddress,
} from "./types";

export interface PopulateExcelOptions {
  /**
   * File template Excel đầu vào dưới dạng ArrayBuffer, Uint8Array hoặc Buffer
   */
  templateBuffer: ArrayBuffer | Uint8Array;
  /**
   * Danh sách quy định ánh xạ ô (VD: [{ cell: "C5", field: "name" }, ...])
   */
  mappings: ExcelCellMapping[];
  /**
   * Dữ liệu các trường cần điền (VD: { name: "Nguyễn Văn A", cccd: "0123456789" })
   */
  data: Record<string, string | number | undefined | null>;
  /**
   * Tên sheet cần điền (nếu không truyền sẽ lấy sheet đầu tiên)
   */
  sheetName?: string | undefined;
}

/**
 * Hàm thuần điền dữ liệu vào template Excel:
 * - Bảo tồn 100% định dạng: font chữ, cỡ chữ, viền, merge cells, màu nền, ảnh logo, độ rộng cột.
 * - Điền giá trị vào các ô theo mappings (ví dụ C5, D10).
 * - Tự động thay thế cả các placeholder {{fieldName}} nếu ô chứa chuỗi giữ chỗ.
 */
export async function populateExcelTemplate(
  options: PopulateExcelOptions,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const buffer =
    options.templateBuffer instanceof Uint8Array
      ? options.templateBuffer
      : new Uint8Array(options.templateBuffer);

  // Load workbook từ buffer
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await workbook.xlsx.load(arrayBuffer as Parameters<typeof workbook.xlsx.load>[0]);

  // Chọn worksheet
  const worksheet = options.sheetName
    ? workbook.getWorksheet(options.sheetName) ?? workbook.worksheets[0]
    : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("Tệp Excel không chứa sheet nào.");
  }

  // 1. Áp dụng các mappings theo tọa độ ô cụ thể
  for (const mapping of options.mappings) {
    const rawCell = mapping.cell?.trim();
    if (!rawCell || !isValidCellAddress(rawCell)) continue;

    const cellAddress = normalizeCellAddress(rawCell);
    const cell = worksheet.getCell(cellAddress);
    const val = options.data[mapping.field];
    cell.value = val !== undefined && val !== null ? String(val) : "";
  }

  // 2. Tìm và thay thế các placeholder dạng {{fieldName}} trong các ô (nếu có)
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && cell.value.includes("{{")) {
        let text = cell.value;
        for (const [key, value] of Object.entries(options.data)) {
          const placeholder = `{{${key}}}`;
          if (text.includes(placeholder)) {
            text = text.replaceAll(placeholder, value !== undefined && value !== null ? String(value) : "");
          }
        }
        cell.value = text;
      }
    });
  });

  const outBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(outBuffer);
}

/**
 * Hàm tạo một file Excel mẫu đơn giản ban đầu (default starter template)
 * để người dùng có thể tải về hoặc dùng thử ngay lập tức.
 */
export async function createDefaultStarterTemplate(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Phiếu nhân viên");

  // Đặt độ rộng cột
  sheet.columns = [
    { width: 5 },  // A
    { width: 22 }, // B - Tiêu đề trường
    { width: 35 }, // C - Giá trị điền
    { width: 20 }, // D - Tiêu đề trường 2
    { width: 25 }, // E - Giá trị điền 2
  ];

  // Header tiêu đề báo cáo
  sheet.mergeCells("B2:E2");
  const titleCell = sheet.getCell("B2");
  titleCell.value = "PHIẾU THÔNG TIN NHÂN SỰ VÀ AN TOÀN LAO ĐỘNG";
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF0F172A" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(2).height = 32;

  // Dòng phụ chú
  sheet.mergeCells("B3:E3");
  const subCell = sheet.getCell("B3");
  subCell.value = "(Dữ liệu xuất tự động từ hệ thống HRM - Format mẫu)";
  subCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF64748B" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };

  const borderStyle: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFCBD5E1" } },
    left: { style: "thin", color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    right: { style: "thin", color: { argb: "FFCBD5E1" } },
  };

  const headerFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };

  const fieldRows: { r: number; label1: string; c1: string; label2: string; c2: string }[] = [
    { r: 5, label1: "Mã nhân viên:", c1: "C5", label2: "Chức vụ:", c2: "E5" },
    { r: 6, label1: "Họ và tên:", c1: "C6", label2: "Giới tính:", c2: "E6" },
    { r: 7, label1: "Ngày sinh:", c1: "C7", label2: "Số điện thoại:", c2: "E7" },
    { r: 8, label1: "Số CCCD:", c1: "C8", label2: "Nhóm an toàn:", c2: "E8" },
    { r: 9, label1: "Nguyên quán:", c1: "C9", label2: "Ngày bắt đầu:", c2: "E9" },
    { r: 10, label1: "Địa chỉ thường trú:", c1: "C10", label2: "Trạng thái:", c2: "E10" },
    { r: 11, label1: "Địa chỉ hiện tại:", c1: "C11", label2: "", c2: "" },
  ];

  for (const item of fieldRows) {
    const row = sheet.getRow(item.r);
    row.height = 24;

    const b = sheet.getCell(`B${item.r}`);
    b.value = item.label1;
    b.font = { name: "Arial", size: 10, bold: true };
    b.fill = headerFill;
    b.border = borderStyle;
    b.alignment = { vertical: "middle" };

    const c = sheet.getCell(item.c1);
    c.font = { name: "Arial", size: 10 };
    c.border = borderStyle;
    c.alignment = { vertical: "middle" };

    if (item.label2) {
      const d = sheet.getCell(`D${item.r}`);
      d.value = item.label2;
      d.font = { name: "Arial", size: 10, bold: true };
      d.fill = headerFill;
      d.border = borderStyle;
      d.alignment = { vertical: "middle" };

      const e = sheet.getCell(item.c2);
      e.font = { name: "Arial", size: 10 };
      e.border = borderStyle;
      e.alignment = { vertical: "middle" };
    } else {
      sheet.mergeCells(`C${item.r}:E${item.r}`);
    }
  }

  // Footer ký tên
  const signRow = sheet.getRow(14);
  signRow.height = 20;
  sheet.getCell("B14").value = "Người lập biểu";
  sheet.getCell("B14").font = { name: "Arial", size: 10, bold: true };
  sheet.getCell("B14").alignment = { horizontal: "center" };

  sheet.getCell("E14").value = "Đại diện công ty";
  sheet.getCell("E14").font = { name: "Arial", size: 10, bold: true };
  sheet.getCell("E14").alignment = { horizontal: "center" };

  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
