import { describe, expect, it } from "vitest";
import { detectColumns, parseDateCell, parseSheet, plainCell, type PlainCell } from "./parse";

const HEADERS: PlainCell[] = ["STT", "Mã NV", "Họ và tên", "Ngày sinh", "Giới tính", "Số CCCD", "SĐT", "Quê quán", "Địa chỉ thường trú", "Chức vụ", "Nhóm ATLĐ", "Ngày vào làm", "Tình trạng"];
const row = (overrides: Partial<Record<string, PlainCell>> = {}): PlainCell[] => {
  const base: Record<string, PlainCell> = { stt: 1, code: "tnm001", name: "Nguyễn  Văn An", dob: "15/03/1990", gender: "Nam", cccd: "001090012345", phone: "0912 345 678", home: "Thái Bình", address: "Hà Nội", position: "nhân viên hiện trường", group: 3, start: "01/06/2015", status: "" };
  const merged = { ...base, ...overrides };
  return [merged.stt!, merged.code!, merged.name!, merged.dob!, merged.gender!, merged.cccd!, merged.phone!, merged.home!, merged.address!, merged.position!, merged.group!, merged.start!, merged.status!];
};

describe("đọc file Excel nhân sự", () => {
  it("tìm dòng tiêu đề dưới dòng tên công ty và nhận tên cột kiểu cũ", () => {
    const detected = detectColumns([["CÔNG TY TNHH THIÊN NHẬT MINH"], [], HEADERS]);
    expect(detected?.headerRow).toBe(2);
    expect(detected?.columns).toMatchObject({ code: 1, name: 2, dob: 3, gender: 4, cccd: 5, phone: 6, home: 7, address: 8, position: 9, group: 10, startDate: 11, status: 12 });
  });

  it("không có tiêu đề nào khớp thì trả null", () => {
    expect(detectColumns([["a", "b"], [1, 2]])).toBeNull();
  });

  it("chuyển một dòng hợp lệ thành hồ sơ đã chuẩn hóa", () => {
    const sheet = parseSheet([HEADERS, row()]);
    expect(sheet?.missing).toEqual([]);
    expect(sheet?.rows[0]).toMatchObject({ rowNumber: 2, errors: [], input: { code: "TNM001", name: "Nguyễn Văn An", dob: "1990-03-15", gender: "Nam", cccd: "001090012345", phone: "0912345678", position: "Nhân viên hiện trường", group: 3, startDate: "2015-06-01", status: "active", endDate: null, emergencyContactId: null } });
  });

  it("bù số 0 đầu khi Excel lưu CCCD và điện thoại thành số", () => {
    // 001090012345 (Hà Nội) thành số 1090012345: mất hai số 0
    expect(parseSheet([HEADERS, row({ cccd: 1090012345, phone: 912345678 })])?.rows[0]?.input).toMatchObject({ cccd: "001090012345", phone: "0912345678" });
    expect(parseSheet([HEADERS, row({ cccd: 31090012345, gender: "Nam" })])?.rows[0]?.input?.cccd).toBe("031090012345");
    // Số 9 chữ số là CMND cũ: giữ nguyên để bước kiểm tra báo đúng lỗi
    expect(parseSheet([HEADERS, row({ cccd: 123456789 })])?.rows[0]?.input?.cccd).toBe("123456789");
  });

  it("để trống giới tính thì lấy theo CCCD và ghi chú lại", () => {
    const parsed = parseSheet([HEADERS, row({ gender: null, cccd: "001190012345" })])?.rows[0];
    expect(parsed?.input?.gender).toBe("Nữ");
    expect(parsed?.notes[0]).toContain("Giới tính lấy theo số CCCD");
  });

  it("ghi rõ lỗi từng ô, không tự đoán", () => {
    const parsed = parseSheet([HEADERS, row({ dob: 1985, position: "Thợ hàn", status: "abc", group: 9 })])?.rows[0];
    expect(parsed?.input).toBeNull();
    expect(parsed?.errors.join(" | ")).toMatch(/Ngày sinh: chỉ có năm 1985/);
    expect(parsed?.errors.join(" | ")).toMatch(/Chức danh: “Thợ hàn” không thuộc danh sách/);
    expect(parsed?.errors.join(" | ")).toMatch(/Nhóm ATLĐ/);
    expect(parsed?.errors.join(" | ")).toMatch(/Tình trạng/);
  });

  it("người nghỉ việc phải có ngày nghỉ", () => {
    const headers = [...HEADERS, "Ngày nghỉ việc"];
    expect(parseSheet([headers, [...row({ status: "Nghỉ việc" }), null]])?.rows[0]?.errors).toContain("Ngày nghỉ việc: người đã nghỉ việc cần có ngày nghỉ");
    expect(parseSheet([headers, [...row({ status: "Nghỉ việc" }), "01/01/2024"]])?.rows[0]?.input).toMatchObject({ status: "resigned", endDate: "2024-01-01" });
  });

  it("đọc cột Ngày vào TNM, để trống thì bỏ qua", () => {
    const headers = [...HEADERS, "Ngày vào TNM"];
    expect(parseSheet([headers, [...row(), "01/03/2019"]])?.rows[0]?.input).toMatchObject({ startDate: "2015-06-01", companyStartDate: "2019-03-01" });
    expect(parseSheet([headers, [...row(), null]])?.rows[0]?.input?.companyStartDate).toBeNull();
  });

  it("bỏ qua dòng trống và báo cột bắt buộc còn thiếu", () => {
    const sheet = parseSheet([["Mã NV", "Họ và tên", "Ngày sinh"], [null, null, null], ["TNM002", "Lê Văn B", "01/01/1990"]]);
    expect(sheet?.rows).toHaveLength(1);
    expect(sheet?.rows[0]?.rowNumber).toBe(3);
    expect(sheet?.missing).toEqual(["cccd", "phone", "position", "startDate"]);
  });
});

describe("đọc ngày", () => {
  it.each([
    [new Date(Date.UTC(1990, 2, 15)), "1990-03-15"],
    [32947, "1990-03-15"],
    ["15/03/1990", "1990-03-15"],
    ["5-3-1990", "1990-03-05"],
    ["15.03.1990", "1990-03-15"],
    ["1990-03-15", "1990-03-15"],
  ])("%s → %s", (input, expected) => {
    expect(parseDateCell(input as PlainCell)).toEqual({ value: expected });
  });

  it.each(["31/02/1990", "1990", "15/03/90", "hôm qua"])("%s là lỗi", (input) => {
    expect(parseDateCell(input)).toHaveProperty("error");
  });
});

describe("gỡ giá trị ô ExcelJS", () => {
  it("lấy kết quả công thức, chữ định dạng và liên kết", () => {
    expect(plainCell({ formula: "A1", result: 5 })).toBe(5);
    expect(plainCell({ richText: [{ text: "Nguyễn " }, { text: "An" }] })).toBe("Nguyễn An");
    expect(plainCell({ text: "0912", hyperlink: "tel:0912" })).toBe("0912");
    expect(plainCell(undefined)).toBeNull();
  });
});
