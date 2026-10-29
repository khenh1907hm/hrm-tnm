import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildExpiringCertificatesWorkbook, expiryStatus, type ExpiringExportRow } from "./expiringCertificates";

const row = (patch: Partial<ExpiringExportRow>): ExpiringExportRow => ({
  employeeCode: "TNM001", employeeName: "Nguyễn Văn A", displayName: "An toàn lao động", type: "atld", number: "007", expiryDate: "2026-11-10",
  daysLeft: 12, reminderSent: false, reminderSendDate: "2026-10-11", ...patch,
});

async function read(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook.getWorksheet("Chứng chỉ hết hạn")!;
}

describe("buildExpiringCertificatesWorkbook", () => {
  it("ghi tiêu đề, số dòng và mỗi chứng chỉ một dòng, hạn gần nhất lên trước", async () => {
    const sheet = await read(await buildExpiringCertificatesWorkbook([
      row({ employeeCode: "TNM002", employeeName: "Trần B", daysLeft: 45, expiryDate: "2026-12-13" }),
      row({ daysLeft: -3, expiryDate: "2026-10-26", reminderSent: true, reminderSentDate: "2026-09-26" }),
    ], { today: "2026-10-29", title: "Chứng chỉ hết hạn và sắp hết hạn", exportedBy: "admin" }));
    expect(sheet.getCell("A1").value).toBe("Chứng chỉ hết hạn và sắp hết hạn");
    expect(sheet.getCell("A2").value).toBe("Ngày xuất: 29/10/2026 · 2 chứng chỉ");
    expect(sheet.getRow(3).values).toEqual([undefined, "STT", "Mã NV", "Họ và tên", "Loại chứng chỉ", "Số chứng chỉ", "Ngày hết hạn", "Còn lại (ngày)", "Tình trạng", "Email nhắc hạn"]);
    expect([4, 5].map((index) => [sheet.getCell(index, 2).value, sheet.getCell(index, 7).value, sheet.getCell(index, 8).value, sheet.getCell(index, 9).value])).toEqual([
      ["TNM001", -3, "Đã hết hạn", "Đã gửi ngày 26/09/2026"],
      ["TNM002", 45, "Hết hạn trong 31–60 ngày", "Sẽ gửi ngày 11/10/2026"],
    ]);
    expect(sheet.getCell(4, 6).value).toEqual(new Date(Date.UTC(2026, 9, 26)));
    expect(sheet.getCell(4, 5).value).toBe("007");
  });

  it("chia tình trạng theo đúng mốc bộ lọc trên trang Cảnh báo", () => {
    expect([-1, 0, 30, 31, 60].map((days) => expiryStatus(days).label)).toEqual(["Đã hết hạn", "Hết hạn trong 30 ngày", "Hết hạn trong 30 ngày", "Hết hạn trong 31–60 ngày", "Hết hạn trong 31–60 ngày"]);
  });
});
