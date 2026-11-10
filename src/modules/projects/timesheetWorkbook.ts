import ExcelJS from "exceljs";
import { dayKind, monthRange, weekdayShort } from "./calendar";
import { hoursMatrix, summarizeByPerson, type WorkRow } from "./reports";
import type { Holiday, LaborSettings, Project, ProjectMember } from "./types";

export type MonthlySheetInput = {
  project: Project;
  month: string;
  members: readonly ProjectMember[];
  rows: readonly WorkRow[];
  settings: LaborSettings;
  holidays: readonly Holiday[];
  /** false: bỏ các cột đơn giá, thành tiền (người xuất không được xem tiền). */
  showMoney: boolean;
  exportedBy: string;
};

const HEADER_FILL = "FF1E3A8A";
const OFF_FILL = "FFF1F5F9";

/**
 * Bảng công tháng (bố cục tạm, spec 6.6, chờ mẫu kế toán): mỗi người một dòng, mỗi ngày một cột "giờ thường/tăng ca",
 * sau đó tổng ngày công, giờ thường, tăng ca theo loại, thành tiền, cột ký nhận.
 */
export async function buildMonthlyTimesheetWorkbook(input: MonthlySheetInput): Promise<Uint8Array> {
  const { from, to } = monthRange(input.month);
  const rows = input.rows.filter((row) => row.workDate >= from && row.workDate <= to);
  const days = Number(to.slice(8, 10));
  const matrix = hoursMatrix(rows, from, days);
  const people = summarizeByPerson(rows, input.members, input.settings);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Quản trị Online TNM";
  const sheet = workbook.addWorksheet(`Bang cong ${input.month}`, { views: [{ state: "frozen", xSplit: 3, ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const [year, month] = input.month.split("-");
  sheet.addRow([`BẢNG CHẤM CÔNG THÁNG ${month}/${year}`]).font = { bold: true, size: 14 };
  sheet.addRow([`Dự án: ${input.project.code} · ${input.project.name}`]);
  sheet.addRow([`Ô ngày ghi "giờ thường/giờ tăng ca"; P = vắng có phép, V = vắng không phép, L = nghỉ lễ. Chỉ gồm phiếu đã gửi hoặc đã duyệt.${input.showMoney ? " Thành tiền chỉ tính phiếu đã duyệt." : ""}`]).font = { italic: true, size: 9 };
  sheet.addRow([]);

  const moneyHeaders = input.showMoney ? ["Thành tiền (VNĐ)"] : [];
  const header = ["STT", "Mã NV", "Họ và tên", "Tổ", ...matrix.dates.map((date) => `${date.slice(8, 10)}\n${weekdayShort(date)}`), "Ngày công", "Giờ thường", "TC ngày thường", "TC nghỉ tuần", "TC lễ", "Tổng tăng ca", ...moneyHeaders, "Ký nhận"];
  const headerRow = sheet.addRow(header);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const abbreviation = { present: "", leave: "P", absent: "V", holiday: "L" } as const;
  people.forEach((person, index) => {
    const cells = matrix.dates.map((date) => {
      const cell = matrix.cell(person.employeeId, date);
      if (!cell) return "";
      if (cell.attendance !== "present") return abbreviation[cell.attendance ?? "present"];
      return cell.ot ? `${cell.regular}/${cell.ot}` : String(cell.regular);
    });
    const row = sheet.addRow([
      index + 1, person.code, person.name, person.team, ...cells, person.daysPresent, person.regularHours,
      person.otByType.weekday, person.otByType.weekly_off, person.otByType.holiday, person.otHours, ...(input.showMoney ? [person.amount] : []), "",
    ]);
    row.eachCell((cell, column) => {
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      cell.font = { size: 9, ...(person.otOverMonth && column === 4 + days + 6 ? { color: { argb: "FF991B1B" }, bold: true } : {}) };
      if (column > 4 && column <= 4 + days) {
        cell.alignment = { horizontal: "center" };
        if (dayKind(matrix.dates[column - 5]!, input.project.weeklyOff, input.holidays) !== "workday") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OFF_FILL } };
      }
    });
    if (input.showMoney) row.getCell(4 + days + 7).numFmt = "#,##0";
  });

  const totalRow = sheet.addRow(["", "", "TỔNG", "", ...matrix.dates.map(() => ""), people.reduce((s, p) => s + p.daysPresent, 0), people.reduce((s, p) => s + p.regularHours, 0),
    people.reduce((s, p) => s + p.otByType.weekday, 0), people.reduce((s, p) => s + p.otByType.weekly_off, 0), people.reduce((s, p) => s + p.otByType.holiday, 0), people.reduce((s, p) => s + p.otHours, 0),
    ...(input.showMoney ? [people.reduce((s, p) => s + p.amount, 0)] : []), ""]);
  totalRow.font = { bold: true, size: 9 };
  if (input.showMoney) totalRow.getCell(4 + days + 7).numFmt = "#,##0";

  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 24;
  sheet.getColumn(4).width = 14;
  for (let column = 5; column <= 4 + days; column++) sheet.getColumn(column).width = 5.2;
  for (let column = 5 + days; column <= header.length; column++) sheet.getColumn(column).width = 11;
  sheet.addRow([]);
  sheet.addRow([`Người lập: ${input.exportedBy}`, "", "", "", ...matrix.dates.map(() => ""), "Chỉ huy trưởng", "", "", "", "PM / Giám đốc"]);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
