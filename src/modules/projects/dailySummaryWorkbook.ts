import ExcelJS from "exceljs";
import { weekdayShort } from "./calendar";
import { PERIOD_LABELS, periodTitle, type DailySummary, type PeriodKind } from "./dailyReportSummary";

export type DailySummaryWorkbookInput = {
  project: { code: string; name: string; stdHours: number };
  kind: PeriodKind;
  summary: DailySummary;
  exportedBy: string;
  exportedOn: string;
};

const HEADER_FILL = "FF1E3A8A";
const OFF_FILL = "FFF1F5F9";
const MISSING_FILL = "FFFEE2E2";
const thin: Partial<ExcelJS.Borders> = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
const dmy = (iso: string) => iso.split("-").reverse().join("/");

function header(ws: ExcelJS.Worksheet, row: number, labels: readonly string[]) {
  labels.forEach((label, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thin;
  });
  ws.getRow(row).height = 30;
}

function title(ws: ExcelJS.Worksheet, text: string, input: DailySummaryWorkbookInput, lastCol: string) {
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell("A2").value = `Dự án: ${input.project.code} · ${input.project.name}    ${periodTitle(input.kind, input.summary)}`;
  ws.getCell("A2").font = { bold: true };
}

/** Báo cáo tuần / tháng (tổng hợp từ BC ngày): sheet Tổng hợp theo ngày, sheet Công việc chi tiết, sheet Theo công việc. */
export async function buildDailySummaryWorkbook(input: DailySummaryWorkbookInput): Promise<Uint8Array> {
  const { summary, kind } = input;
  const workbook = new ExcelJS.Workbook();
  const page = { paperSize: 9 as const, orientation: "landscape" as const, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── Sheet 1: tổng hợp theo ngày ──
  const ws = workbook.addWorksheet("Tổng hợp", { pageSetup: page, views: [{ state: "frozen", ySplit: 9 }] });
  ws.columns = [{ width: 12 }, { width: 6 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 10 }, { width: 9 }, { width: 10 }, { width: 60 }, { width: 18 }];
  title(ws, `BÁO CÁO ${PERIOD_LABELS[kind].toUpperCase()} DỰ ÁN`, input, "J");
  const kpis: [string, string | number][] = [
    ["Ngày có báo cáo", `${summary.reportedDays} / ${summary.days.length}`],
    ["Tổng công (người × ngày)", summary.workdays],
    [`Giờ công (${input.project.stdHours} giờ/công)`, summary.regularHours],
    ["Tăng ca (lượt người)", summary.otPersonDays],
    ["Giờ tăng ca", summary.otHours],
    ["Hiện diện trung bình / cao nhất", `${summary.avgPresent} / ${summary.maxPresent}`],
  ];
  kpis.forEach(([label, value], index) => {
    const row = 4 + Math.floor(index / 2);
    const col = index % 2 === 0 ? 1 : 6;
    ws.mergeCells(row, col, row, col + 2);
    ws.getCell(row, col).value = label;
    ws.getCell(row, col).font = { color: { argb: "FF475569" } };
    ws.getCell(row, col + 3).value = value;
    ws.getCell(row, col + 3).font = { bold: true };
  });
  if (summary.missingDates.length) {
    ws.mergeCells("A7:J7");
    ws.getCell("A7").value = `Chưa có báo cáo: ${summary.missingDates.map(dmy).join(", ")}`;
    ws.getCell("A7").font = { color: { argb: "FFB91C1C" }, italic: true };
  }
  header(ws, 9, ["Ngày", "Thứ", "Tổng số", "Hiện diện", "Vắng", "SL tăng ca", "Giờ TC", "Giờ công", "Công việc", "Người lập"]);
  let row = 10;
  for (const day of summary.days) {
    const report = day.report;
    const values = [dmy(day.date), weekdayShort(day.date), report?.total ?? null, report?.present ?? null, report?.absent ?? null,
      report ? report.otCount : null, report ? report.otHours : null, report?.present != null ? report.present * input.project.stdHours : null,
      report ? report.tasks.map((task) => task.task).join("; ") : day.missing ? "Chưa có báo cáo" : day.kind === "workday" ? "" : day.kind === "holiday" ? "Ngày lễ" : "Nghỉ tuần",
      report?.createdByName ?? ""];
    values.forEach((value, index) => {
      const cell = ws.getCell(row, index + 1);
      cell.value = value;
      cell.border = thin;
      cell.alignment = { vertical: "top", wrapText: index === 8, horizontal: index >= 2 && index <= 7 ? "center" : "left" };
      if (day.missing) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MISSING_FILL } };
      else if (day.kind !== "workday") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OFF_FILL } };
    });
    row += 1;
  }
  const totals = ["Tổng", "", "", summary.workdays, summary.absentDays, summary.otPersonDays, summary.otHours, summary.regularHours, `${summary.reportedDays} ngày có báo cáo`, ""];
  totals.forEach((value, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = value;
    cell.font = { bold: true };
    cell.border = thin;
    cell.alignment = { horizontal: index >= 2 && index <= 7 ? "center" : "left" };
  });
  ws.getCell(row + 2, 1).value = `Xuất ngày ${dmy(input.exportedOn)} bởi ${input.exportedBy}. Số liệu lấy từ báo cáo ngày (BC ngày) đã gửi.`;
  ws.getCell(row + 2, 1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };

  // ── Sheet 2: công việc từng ngày ──
  const detail = workbook.addWorksheet("Công việc", { pageSetup: { ...page, orientation: "portrait" }, views: [{ state: "frozen", ySplit: 4 }] });
  detail.columns = [{ width: 12 }, { width: 6 }, { width: 40 }, { width: 18 }, { width: 45 }, { width: 8 }];
  title(detail, `CÔNG VIỆC ${PERIOD_LABELS[kind].toUpperCase()}`, input, "F");
  header(detail, 4, ["Ngày", "STT", "Công việc", "Nhóm trưởng", "Thành viên", "Số người"]);
  row = 5;
  for (const day of summary.days) {
    for (const task of day.report?.tasks ?? []) {
      const people = task.members.length + (task.leader && !task.members.includes(task.leader) ? 1 : 0);
      [dmy(day.date), task.no, task.task, task.leader, task.members.join(" + "), people].forEach((value, index) => {
        const cell = detail.getCell(row, index + 1);
        cell.value = value;
        cell.border = thin;
        cell.alignment = { vertical: "top", wrapText: index === 2 || index === 4, horizontal: index === 1 || index === 5 ? "center" : "left" };
      });
      row += 1;
    }
  }

  // ── Sheet 3: tổng hợp theo công việc ──
  const byTask = workbook.addWorksheet("Theo công việc", { pageSetup: { ...page, orientation: "portrait" } });
  byTask.columns = [{ width: 6 }, { width: 50 }, { width: 12 }, { width: 14 }, { width: 30 }];
  title(byTask, "TỔNG HỢP THEO CÔNG VIỆC", input, "E");
  header(byTask, 4, ["STT", "Công việc", "Số ngày", "Người × ngày", "Nhóm trưởng"]);
  summary.tasks.forEach((task, index) => {
    [index + 1, task.task, task.days, task.personDays, task.leaders.join(", ")].forEach((value, col) => {
      const cell = byTask.getCell(5 + index, col + 1);
      cell.value = value;
      cell.border = thin;
      cell.alignment = { vertical: "top", wrapText: col === 1, horizontal: col === 0 || col === 2 || col === 3 ? "center" : "left" };
    });
  });

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
