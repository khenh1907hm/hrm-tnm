import { describe, expect, it } from "vitest";
import { inferToastVariant, toastDuration } from "./toastVariant";

describe("inferToastVariant", () => {
  it("classifies common Vietnamese messages", () => {
    expect(inferToastVariant("Đã lưu hồ sơ nhân sự.")).toBe("success");
    expect(inferToastVariant("Không đọc được ảnh chữ ký.")).toBe("error");
    expect(inferToastVariant("Lỗi khi điền dữ liệu vào tệp Excel.")).toBe("error");
    expect(inferToastVariant("Đã tải hồ sơ Excel, còn 2 mục cần kiểm tra.")).toBe("warning");
    expect(inferToastVariant("Chưa có địa chỉ nhận.")).toBe("warning");
    expect(inferToastVariant("Tệp mẫu không có dữ liệu xem trước trong phiên này.")).toBe("warning");
    expect(inferToastVariant("Đang tạo tệp PDF trong trình duyệt…")).toBe("info");
  });

  it("gives long messages more reading time, capped at 10 seconds", () => {
    expect(toastDuration("Ngắn")).toBe(4_500);
    expect(toastDuration("a".repeat(110))).toBe(6_500);
    expect(toastDuration("a".repeat(1_000))).toBe(10_000);
  });
});
