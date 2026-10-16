import { describe, expect, it } from "vitest";
import { parseSheet } from "./parse";
import { buildErrorReport, buildImportTemplate, readWorkbook } from "./workbook";

const buffer = (bytes: Uint8Array) => bytes.slice().buffer;

describe("file mẫu và file báo lỗi", () => {
  it("file mẫu đọc lại được, dòng ví dụ hợp lệ", async () => {
    const sheets = await readWorkbook(buffer(await buildImportTemplate()));
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Nhân sự", "Hướng dẫn"]);
    const parsed = parseSheet(sheets[0]!.rows);
    expect(parsed?.missing).toEqual([]);
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows[0]).toMatchObject({ errors: [], input: { code: "TNM001", cccd: "001090012345", phone: "0912345678", dob: "1990-03-15" } });
  });

  it("file dòng lỗi giữ cột gốc, thêm lý do, và nhập lại được sau khi sửa", async () => {
    const headers = ["Mã NV", "Họ và tên", "Ngày sinh", "Số CCCD", "SĐT", "Chức vụ", "Ngày vào làm"];
    const report = await buildErrorReport(headers, [{ rowNumber: 6, cells: ["TNM803", "Trần Quốc Toản", "1979", "031079001234", "0901234567", "Nhân viên kỹ thuật", "01/01/2005"], messages: ["Ngày sinh: chỉ có năm 1979"] }]);
    const [sheet] = await readWorkbook(buffer(report));
    expect(sheet!.rows[0]).toEqual(["Dòng trong file", ...headers, "Lỗi cần sửa"]);
    expect(sheet!.rows[1]?.at(-1)).toBe("Ngày sinh: chỉ có năm 1979");
    // Người dùng sửa ngày sinh ngay trong file rồi nhập lại
    sheet!.rows[1]![3] = "05/05/1979";
    const parsed = parseSheet(sheet!.rows);
    expect(parsed?.missing).toEqual([]);
    expect(parsed?.rows[0]).toMatchObject({ errors: [], input: { code: "TNM803", dob: "1979-05-05", gender: "Nam" } });
  });
});
