import ExcelJS from "exceljs";
import { diffDays } from "../../lib/dates";
import type { Certificate } from "../certificates/types";
import type { Employee, EmploymentStatus } from "../employees/types";

export type RosterData = {
  employees: readonly Employee[];
  /** Chứng chỉ hiện hành của các nhân sự trên. */
  certificates: readonly Certificate[];
  certificateTypes: readonly { key: string; name: string; requiredForPositions: readonly string[] }[];
  today: string;
  exportedBy: string;
};

const STATUS: Record<EmploymentStatus, string> = { active: "Đang làm việc", on_leave: "Tạm nghỉ", resigned: "Đã nghỉ việc" };
const HEADER_FILL = "FF1E3A8A";
const TONE = { ok: { fill: "FFDCFCE7", font: "FF166534" }, warn: { fill: "FFFFEDD5", font: "FF9A3412" }, bad: { fill: "FFFEE2E2", font: "FF991B1B" } } as const;
type Tone = keyof typeof TONE;

/** "2026-03-15" → ngày Excel (UTC, không lệch múi giờ). */
const toDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const vnDate = (iso: string) => iso.split("-").reverse().join("/");

function certificateTone(certificate: Certificate, today: string): Tone {
  const daysLeft = diffDays(today, certificate.expiryDate);
  return daysLeft < 0 ? "bad" : daysLeft <= 30 ? "warn" : "ok";
}
const toneLabel: Record<Tone, string> = { ok: "Còn hạn", warn: "Sắp hết hạn", bad: "Đã hết hạn" };

function styleHeader(row: ExcelJS.Row): void {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF93C5FD" } } };
  });
}
function paint(cell: ExcelJS.Cell, tone: Tone): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE[tone].fill } };
  cell.font = { color: { argb: TONE[tone].font }, bold: true };
}

/**
 * Bảng tổng hợp toàn bộ thông tin các nhân sự được chọn:
 * - Sheet "Nhân sự": mỗi người một dòng, mỗi loại chứng chỉ một cột (tô màu theo hạn).
 * - Sheet "Chứng chỉ": mỗi chứng chỉ hiện hành một dòng.
 */
export async function buildEmployeeRosterWorkbook(data: RosterData): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = data.exportedBy;
  workbook.created = toDate(data.today)!;
  const typeName = (key: string) => data.certificateTypes.find((type) => type.key === key)?.name ?? key;
  const byEmployee = (employeeId: string) => data.certificates.filter((certificate) => certificate.employeeId === employeeId);

  // ===== Sheet 1: Nhân sự =====
  const sheet = workbook.addWorksheet("Nhân sự", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
  const baseColumns: { header: string; key: string; width: number; date?: boolean }[] = [
    { header: "STT", key: "no", width: 6 },
    { header: "Mã NV", key: "code", width: 10 },
    { header: "Họ và tên", key: "name", width: 26 },
    { header: "Giới tính", key: "gender", width: 9 },
    { header: "Ngày sinh", key: "dob", width: 12, date: true },
    { header: "Số CCCD", key: "cccd", width: 15 },
    { header: "Điện thoại", key: "phone", width: 13 },
    { header: "Quê quán", key: "home", width: 30 },
    { header: "Nơi thường trú", key: "address", width: 36 },
    { header: "Địa chỉ hiện tại", key: "currentAddress", width: 36 },
    { header: "Chức danh", key: "position", width: 22 },
    { header: "Nhóm ATLĐ", key: "group", width: 10 },
    { header: "Ngày làm nghề", key: "startDate", width: 13, date: true },
    { header: "Ngày vào TNM", key: "companyStartDate", width: 13, date: true },
    { header: "Tình trạng", key: "status", width: 14 },
    { header: "Ngày nghỉ việc", key: "endDate", width: 13, date: true },
    { header: "Tình trạng chứng chỉ", key: "health", width: 30 },
  ];
  sheet.columns = [...baseColumns.map(({ header, key, width }) => ({ header, key, width })), ...data.certificateTypes.map((type) => ({ header: type.name, key: `cert:${type.key}`, width: 24 }))];
  styleHeader(sheet.getRow(1));

  data.employees.forEach((employee, index) => {
    const certificates = byEmployee(employee.id);
    const missing = data.certificateTypes.filter((type) => type.requiredForPositions.includes(employee.position) && !certificates.some((certificate) => certificate.type === type.key));
    const tones = certificates.map((certificate) => certificateTone(certificate, data.today));
    const problems = [
      ...(missing.length ? [`Thiếu: ${missing.map((type) => type.name).join(", ")}`] : []),
      ...(tones.includes("bad") ? [`${tones.filter((tone) => tone === "bad").length} đã hết hạn`] : []),
      ...(tones.includes("warn") ? [`${tones.filter((tone) => tone === "warn").length} sắp hết hạn`] : []),
    ];
    const row = sheet.addRow({
      no: index + 1, code: employee.code, name: employee.name, gender: employee.gender, dob: toDate(employee.dob), cccd: employee.cccd, phone: employee.phone,
      home: employee.home, address: employee.address, currentAddress: employee.currentAddress || employee.address, position: employee.position,
      group: employee.group ?? "", startDate: toDate(employee.startDate), companyStartDate: toDate(employee.companyStartDate ?? null), status: employee.archivedAt ? "Đã lưu trữ" : STATUS[employee.status], endDate: toDate(employee.endDate),
      health: problems.length ? problems.join("; ") : "Đầy đủ, còn hạn",
    });
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell("cccd").numFmt = "@";
    row.getCell("phone").numFmt = "@";
    paint(row.getCell("health"), missing.length || tones.includes("bad") ? "bad" : tones.includes("warn") ? "warn" : "ok");
    for (const type of data.certificateTypes) {
      const own = certificates.filter((certificate) => certificate.type === type.key);
      const cell = row.getCell(`cert:${type.key}`);
      if (!own.length) {
        if (type.requiredForPositions.includes(employee.position)) { cell.value = "Thiếu (bắt buộc)"; paint(cell, "bad"); }
        continue;
      }
      cell.value = own.map((certificate) => `${certificate.title ? `${certificate.title} · ` : ""}Số ${certificate.number} · HH ${vnDate(certificate.expiryDate)}`).join("\n");
      const worst = own.map((certificate) => certificateTone(certificate, data.today));
      paint(cell, worst.includes("bad") ? "bad" : worst.includes("warn") ? "warn" : "ok");
    }
  });
  for (const column of baseColumns.filter((item) => item.date)) sheet.getColumn(column.key).numFmt = "dd/mm/yyyy";
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  // ===== Sheet 2: Chứng chỉ =====
  const detail = workbook.addWorksheet("Chứng chỉ", { views: [{ state: "frozen", ySplit: 1 }] });
  detail.columns = [
    { header: "Mã NV", key: "code", width: 10 }, { header: "Họ và tên", key: "name", width: 26 }, { header: "Loại chứng chỉ", key: "type", width: 26 },
    { header: "Tên phân biệt", key: "title", width: 18 }, { header: "Số chứng chỉ", key: "number", width: 18 }, { header: "Ngày cấp", key: "issueDate", width: 12 },
    { header: "Ngày hết hạn", key: "expiryDate", width: 12 }, { header: "Còn lại (ngày)", key: "daysLeft", width: 12 }, { header: "Trạng thái", key: "state", width: 14 },
    { header: "Số tệp đính kèm", key: "files", width: 12 },
  ];
  styleHeader(detail.getRow(1));
  for (const employee of data.employees) {
    for (const certificate of byEmployee(employee.id)) {
      const tone = certificateTone(certificate, data.today);
      const row = detail.addRow({
        code: employee.code, name: employee.name, type: typeName(certificate.type), title: certificate.title, number: certificate.number,
        issueDate: toDate(certificate.issueDate), expiryDate: toDate(certificate.expiryDate), daysLeft: diffDays(data.today, certificate.expiryDate),
        state: toneLabel[tone], files: 1 + certificate.supplementaryFiles.length,
      });
      paint(row.getCell("state"), tone);
    }
  }
  detail.getColumn("issueDate").numFmt = "dd/mm/yyyy";
  detail.getColumn("expiryDate").numFmt = "dd/mm/yyyy";
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: detail.columnCount } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
