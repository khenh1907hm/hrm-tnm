import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DailyReport } from "./dailyReport";
import { periodRange, shiftPeriod, summarizeDailyReports } from "./dailyReportSummary";
import { buildDailySummaryWorkbook } from "./dailySummaryWorkbook";

const report = (date: string, present: number, ot: [number, number], tasks: DailyReport["tasks"]): DailyReport => ({
  id: date, projectId: "p1", date, total: present + 1, present, absent: 1, absentNames: [], otCount: ot[0], otHours: ot[1], tasks, photoCount: 0, createdByName: "CHT A", sentAt: null, sentError: "",
});
const options = { weeklyOff: [0], holidays: [], stdHours: 8, today: "2026-11-12" };

describe("báo cáo tuần / tháng từ BC ngày", () => {
  it("tính kỳ tuần (T2–CN), tháng, chuyển kỳ", () => {
    expect(periodRange("week", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(periodRange("month", "2026-11-12")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(shiftPeriod("week", "2026-11-12", -1)).toBe("2026-11-02");
    expect(shiftPeriod("month", "2026-01-20", -1)).toBe("2025-12-01");
    expect(shiftPeriod("month", "2026-12-05", 1)).toBe("2027-01-01");
  });

  it("cộng công, giờ công, tăng ca; liệt kê ngày làm việc thiếu báo cáo, bỏ ngày nghỉ và ngày chưa tới", () => {
    const reports = [
      report("2026-11-09", 10, [2, 4], [{ no: 1, task: "Lắp ống", leader: "Giang", members: ["Kiến", "Hòa"] }]),
      report("2026-11-11", 12, [0, 0], [{ no: 1, task: "lắp  ống", leader: "Giang", members: ["Kiến"] }, { no: 2, task: "Đi dây", leader: "", members: ["An"] }]),
      report("2026-10-30", 99, [9, 9], []),
    ];
    const summary = summarizeDailyReports(reports, periodRange("week", "2026-11-12"), options);
    expect(summary.days).toHaveLength(7);
    expect(summary.reportedDays).toBe(2);
    expect(summary.workdays).toBe(22);
    expect(summary.regularHours).toBe(176);
    expect(summary.otPersonDays).toBe(2);
    expect(summary.otHours).toBe(4);
    expect(summary.avgPresent).toBe(11);
    expect(summary.maxPresent).toBe(12);
    // T3 10/11 và T5 12/11 thiếu; T6, T7 chưa tới; CN 15/11 nghỉ tuần
    expect(summary.missingDates).toEqual(["2026-11-10", "2026-11-12"]);
    expect(summary.tasks[0]).toEqual({ task: "Lắp ống", days: 2, personDays: 5, leaders: ["Giang"] });
    expect(summary.tasks[1]?.task).toBe("Đi dây");
  });

  it("ngày trước khi dự án bắt đầu không tính là thiếu báo cáo", () => {
    const summary = summarizeDailyReports([], periodRange("week", "2026-11-12"), { ...options, startDate: "2026-11-11" });
    expect(summary.missingDates).toEqual(["2026-11-11", "2026-11-12"]);
  });

  it("xuất Excel 3 sheet, có dòng tổng và đánh dấu ngày thiếu", async () => {
    const summary = summarizeDailyReports([report("2026-11-09", 10, [2, 4], [{ no: 1, task: "Lắp ống", leader: "Giang", members: ["Kiến"] }])], periodRange("week", "2026-11-12"), options);
    const bytes = await buildDailySummaryWorkbook({ project: { code: "DA-1", name: "Dự án mẫu", stdHours: 8 }, kind: "week", summary, exportedBy: "PM", exportedOn: "2026-11-12" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Tổng hợp", "Công việc", "Theo công việc"]);
    const sheet = workbook.getWorksheet("Tổng hợp")!;
    expect(String(sheet.getCell("A1").value)).toBe("BÁO CÁO TUẦN DỰ ÁN");
    expect(sheet.getCell("D10").value).toBe(10);
    expect(sheet.getCell("H10").value).toBe(80);
    expect(sheet.getCell("I11").value).toBe("Chưa có báo cáo");
    expect(sheet.getCell("A17").value).toBe("Tổng");
    expect(sheet.getCell("D17").value).toBe(10);
    expect(workbook.getWorksheet("Công việc")!.getCell("C5").value).toBe("Lắp ống");
  });
});
