import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createHrApp } from "../../app-core/createHrApp";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";
import { buildEmployeeRosterWorkbook, type RosterData } from "./employeeRoster";

const file = { id: "f", name: "a.pdf", mime: "application/pdf", size: 1 };
const employee = (patch: Partial<Employee>): Employee => ({
  id: "e1", code: "TNM001", name: "Nguyễn Văn A", dob: "1990-05-02", gender: "Nam", cccd: "079090000001", phone: "0901234567", home: "Hà Nội", address: "TP.HCM", currentAddress: "",
  position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "c1", status: "active", endDate: null,
  version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, ...patch,
});
const certificate = (patch: Partial<Certificate>): Certificate => ({
  id: "c", employeeId: "e1", type: "atld", title: "", number: "N1", expiryDate: "2027-01-01", issueDate: "2025-01-01", document: file, supplementaryFiles: [],
  state: "current", version: 1, replacedBy: null, archiveReason: null, ...patch,
});

async function read(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook;
}

describe("buildEmployeeRosterWorkbook", () => {
  const data: RosterData = {
    today: "2026-10-12", exportedBy: "admin",
    certificateTypes: [
      { key: "atld", name: "An toàn lao động", requiredForPositions: ["Nhân viên hiện trường"] },
      { key: "health", name: "Khám sức khỏe", requiredForPositions: ["Nhân viên hiện trường"] },
      { key: "weld", name: "Chứng chỉ hàn", requiredForPositions: [] },
    ],
    employees: [
      employee({}),
      employee({ id: "e2", code: "TNM002", name: "Lê Thị C", gender: "Nữ", currentAddress: "Đà Nẵng", group: null, emergencyContactId: null, status: "resigned", endDate: "2026-09-30", position: "Giám đốc" }),
      employee({ id: "e3", code: "TNM003", archivedAt: "2026-10-01T00:00:00Z" }),
      employee({ id: "e4", code: "TNM004", position: "Giám đốc" }),
    ],
    certificates: [
      certificate({ id: "a1", title: "Nhóm 3", number: "ATLD-3", expiryDate: "2026-10-20" }),
      certificate({ id: "a2", title: "Nhóm 1", number: "ATLD-1", expiryDate: "2027-05-01" }),
      certificate({ id: "h1", type: "health", number: "KSK", expiryDate: "2026-10-01", issueDate: null, supplementaryFiles: [{ file, label: "Mặt sau" }] }),
      certificate({ id: "w1", employeeId: "e2", type: "weld", number: "H-1", expiryDate: "2028-01-01" }),
      certificate({ id: "x1", employeeId: "e3", type: "legacy", number: "L-1", expiryDate: "2028-01-01" }),
      certificate({ id: "w4", employeeId: "e4", type: "weld", number: "H-4", expiryDate: "2026-10-30" }),
    ],
  };

  it("writes one row per employee with every profile field and a coloured column per certificate type", async () => {
    const workbook = await read(await buildEmployeeRosterWorkbook(data));
    const sheet = workbook.getWorksheet("Nhân sự")!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(["STT", "Mã NV", "Họ và tên", "Giới tính", "Ngày sinh", "Số CCCD", "Điện thoại", "Quê quán", "Nơi thường trú", "Địa chỉ hiện tại", "Chức danh", "Nhóm ATLĐ", "Ngày làm nghề", "Ngày vào TNM", "Tình trạng", "Ngày nghỉ việc", "Tình trạng chứng chỉ", "An toàn lao động", "Khám sức khỏe", "Chứng chỉ hàn"]);
    const first = sheet.getRow(2);
    expect(first.getCell(6).value).toBe("079090000001");
    expect(first.getCell(6).numFmt).toBe("@");
    expect((first.getCell(5).value as Date).toISOString().slice(0, 10)).toBe("1990-05-02");
    expect(first.getCell(10).value).toBe("TP.HCM"); // không có địa chỉ hiện tại → lấy thường trú
    expect(first.getCell(17).value).toBe("1 đã hết hạn; 1 sắp hết hạn");
    expect(first.getCell(18).value).toBe("Nhóm 3 · Số ATLD-3 · HH 20/10/2026\nNhóm 1 · Số ATLD-1 · HH 01/05/2027");
    expect((first.getCell(18).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFEDD5");
    expect((first.getCell(19).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFEE2E2");
    expect(first.getCell(20).value).toBeNull();

    const second = sheet.getRow(3);
    expect([second.getCell(10).value, second.getCell(12).value, second.getCell(15).value]).toEqual(["Đà Nẵng", "", "Đã nghỉ việc"]);
    expect(second.getCell(17).value).toBe("Đầy đủ, còn hạn");
    expect((second.getCell(20).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFDCFCE7");

    const third = sheet.getRow(4);
    expect(third.getCell(15).value).toBe("Đã lưu trữ");
    expect(third.getCell(17).value).toBe("Thiếu: An toàn lao động, Khám sức khỏe");
    expect(third.getCell(18).value).toBe("Thiếu (bắt buộc)");
    expect(sheet.getRow(5).getCell(17).value).toBe("1 sắp hết hạn");
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("lists every current certificate on the second sheet", async () => {
    const workbook = await read(await buildEmployeeRosterWorkbook(data));
    const detail = workbook.getWorksheet("Chứng chỉ")!;
    expect(detail.rowCount).toBe(7);
    const health = detail.getRow(4);
    expect([health.getCell(3).value, health.getCell(6).value, health.getCell(8).value, health.getCell(9).value, health.getCell(10).value]).toEqual(["Khám sức khỏe", null, -11, "Đã hết hạn", 2]);
    expect(detail.getRow(6).getCell(3).value).toBe("legacy");
  });
});

describe("exports.employeeRoster use case", () => {
  it("returns full CCCD for the chosen employees, sorted by code, and writes an audit entry", async () => {
    const clock = fixedClock("2026-10-12T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("seed-roster"));
    const app = createHrApp({ clock, ids: sequentialIds("roster"), repositories });
    const admin = { id: "admin", role: "admin" as const };
    const listed = await app.employees.list(admin, { pageSize: 3 });
    if (!listed.ok) throw new Error("seed");
    const ids = listed.value.items.map((item) => item.id).reverse();
    const result = await app.exports.employeeRoster({ id: "hr", role: "hr" }, { employeeIds: [...ids, ids[0]!] });
    if (!result.ok) throw new Error(result.errors[0]?.code);
    expect(result.value.employees.map((item) => item.code)).toEqual(["TNM001", "TNM002", "TNM003"]);
    expect(result.value.employees[0]!.cccd).not.toContain("•");
    expect(result.value.certificates.every((item) => item.state === "current" && ids.includes(item.employeeId))).toBe(true);
    expect(result.value.today).toBe("2026-10-12");
    const audit = await repositories.audit.list();
    expect(audit.some((event) => event.action === "employee.roster.export")).toBe(true);
    expect(await app.exports.employeeRoster(admin, { employeeIds: [] })).toMatchObject({ ok: false });
    expect(await app.exports.employeeRoster(admin, { employeeIds: ["missing"] })).toMatchObject({ ok: false });
  });
});
