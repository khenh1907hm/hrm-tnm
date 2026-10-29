import ExcelJS from "exceljs";

export type ExpiringExportRow = {
  employeeCode?: string | undefined;
  employeeName?: string | undefined;
  displayName?: string | undefined;
  type: string;
  number: string;
  expiryDate: string;
  daysLeft: number;
  reminderSent: boolean;
  reminderSentDate?: string | null | undefined;
  reminderSendDate: string;
};

const HEADER_FILL = "FF1E3A8A";
const TONE = { warn: { fill: "FFFFEDD5", font: "FF9A3412" }, bad: { fill: "FFFEE2E2", font: "FF991B1B" }, soon: { fill: "FFFEF9C3", font: "FF854D0E" } } as const;

/** "2026-03-15" → ngày Excel (UTC, không lệch múi giờ). */
const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const vnDate = (iso: string) => iso.split("-").reverse().join("/");

/** Tình trạng theo số ngày còn lại, cùng mốc với bộ lọc trên trang Cảnh báo. */
export function expiryStatus(daysLeft: number): { label: string; tone: keyof typeof TONE } {
  if (daysLeft < 0) return { label: "Đã hết hạn", tone: "bad" };
  if (daysLeft <= 30) return { label: "Hết hạn trong 30 ngày", tone: "warn" };
  return { label: "Hết hạn trong 31–60 ngày", tone: "soon" };
}

/** Danh sách chứng chỉ hết hạn / sắp hết hạn (đúng các dòng đang lọc trên trang Cảnh báo), hạn gần nhất lên trước. */
export async function buildExpiringCertificatesWorkbook(rows: readonly ExpiringExportRow[], options: { today: string; title: string; exportedBy: string }): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.exportedBy;
  workbook.created = toDate(options.today);
  const sheet = workbook.addWorksheet("Chứng chỉ hết hạn", { views: [{ state: "frozen", ySplit: 3 }] });
  sheet.columns = [
    { key: "no", width: 6 }, { key: "code", width: 11 }, { key: "name", width: 28 }, { key: "type", width: 30 }, { key: "number", width: 18 },
    { key: "expiryDate", width: 14 }, { key: "daysLeft", width: 12 }, { key: "status", width: 24 }, { key: "reminder", width: 26 },
  ];
  sheet.mergeCells(1, 1, 1, 9);
  const title = sheet.getCell(1, 1);
  title.value = options.title;
  title.font = { bold: true, size: 14, color: { argb: HEADER_FILL } };
  sheet.mergeCells(2, 1, 2, 9);
  sheet.getCell(2, 1).value = `Ngày xuất: ${vnDate(options.today)} · ${rows.length} chứng chỉ`;
  sheet.getCell(2, 1).font = { italic: true, color: { argb: "FF475569" } };

  const header = sheet.getRow(3);
  header.values = ["STT", "Mã NV", "Họ và tên", "Loại chứng chỉ", "Số chứng chỉ", "Ngày hết hạn", "Còn lại (ngày)", "Tình trạng", "Email nhắc hạn"];
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  [...rows].sort((a, b) => a.daysLeft - b.daysLeft || (a.employeeCode ?? "").localeCompare(b.employeeCode ?? "", "en", { numeric: true })).forEach((item, index) => {
    const status = expiryStatus(item.daysLeft);
    const row = sheet.addRow({
      no: index + 1, code: item.employeeCode ?? "", name: item.employeeName ?? "", type: item.displayName ?? item.type, number: item.number,
      expiryDate: toDate(item.expiryDate), daysLeft: item.daysLeft, status: status.label,
      reminder: item.reminderSent ? `Đã gửi ngày ${vnDate(item.reminderSentDate ?? item.reminderSendDate)}` : `Sẽ gửi ngày ${vnDate(item.reminderSendDate)}`,
    });
    row.getCell("number").numFmt = "@";
    for (const key of ["daysLeft", "status"]) {
      const cell = row.getCell(key);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE[status.tone].fill } };
      cell.font = { bold: true, color: { argb: TONE[status.tone].font } };
    }
  });
  sheet.getColumn("expiryDate").numFmt = "dd/mm/yyyy";
  sheet.getColumn("daysLeft").alignment = { horizontal: "center" };
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 9 } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
