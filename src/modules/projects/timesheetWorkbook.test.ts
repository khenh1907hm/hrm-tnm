import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { flattenTimesheets } from "./reports";
import { buildMonthlyTimesheetWorkbook } from "./timesheetWorkbook";
import { DEFAULT_LABOR_SETTINGS, DEFAULT_SITE_SETTINGS, type Project, type ProjectMember, type Timesheet } from "./types";

const project: Project = { id: "p1", code: "DA-1", name: "Dự án mẫu", customerId: null, customerName: "", site: "", pmEmployeeId: null, plannedStart: "2026-11-01", plannedEnd: "2026-11-30", actualStart: null, actualEnd: null, stdHours: 8, weeklyOff: [0], status: "active", note: "", ...DEFAULT_SITE_SETTINGS, updatedAt: "" };
const member: ProjectMember = { id: "m1", projectId: "p1", employeeId: "e1", displayName: "Nguyễn Văn A", employeeCode: "TNM001", role: "worker", parentId: null, team: "Tổ 1", subcontractId: null, joinedOn: "2026-11-01", leftOn: null };
const sheet = (workDate: string, otHours: number, id: string): Timesheet => ({ id, projectId: "p1", workDate, team: "Tổ 1", status: "approved", submittedAt: null, approvedAt: null, rejectReason: "", lines: [{ id: `l${id}`, employeeId: "e1", attendance: "present", regularHours: 8, otHours, otType: "weekday", nightHours: 0, note: "" }] });

async function read(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
  return workbook.worksheets[0]!;
}

describe("monthly timesheet workbook", () => {
  it("PRJ_12 writes one row per person with day cells, totals and money only when allowed", async () => {
    const rows = flattenTimesheets([sheet("2026-11-02", 2, "a"), sheet("2026-11-03", 0, "b"), sheet("2026-12-01", 0, "c")], [{ lineId: "la", projectId: "p1", workDate: "2026-11-02", employeeId: "e1", category: "labor", rate: 40_000, otMultiplier: 1.5, nightBonus: 0.3, amount: 440_000 }]);
    const input = { project, month: "2026-11", members: [member], rows, settings: DEFAULT_LABOR_SETTINGS, holidays: [], exportedBy: "Admin" };
    const withMoney = await read(await buildMonthlyTimesheetWorkbook({ ...input, showMoney: true }));
    const header = withMoney.getRow(5).values as unknown[];
    expect(header).toContain("Thành tiền (VNĐ)");
    const row = withMoney.getRow(6);
    expect(row.getCell(3).value).toBe("Nguyễn Văn A");
    expect(row.getCell(4 + 2).value).toBe("8/2"); // ngày 02
    expect(row.getCell(4 + 3).value).toBe("8"); // ngày 03
    expect(row.getCell(4 + 30 + 1).value).toBe(2); // ngày công (bỏ ngày 01/12)
    expect(row.getCell(4 + 30 + 7).value).toBe(440_000);
    const noMoney = await read(await buildMonthlyTimesheetWorkbook({ ...input, showMoney: false }));
    expect(noMoney.getRow(5).values as unknown[]).not.toContain("Thành tiền (VNĐ)");
  });
});
