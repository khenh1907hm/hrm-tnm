import { describe, expect, it } from "vitest";
import { certificateFileBaseName, certificateRootFolderName, certificateTypeLabel, employeeFolderName, uniqueFileNames } from "./certificateExportNames";

const duc = { code: "TNM0018", name: "Trần Ngọc Đức" };
const typeNames = { "custom-ctype-cccd": "Căn cước công dân", atld: "An toàn lao động" };

describe("đặt tên khi xuất riêng chứng chỉ", () => {
  it("mặc định đánh số theo thứ tự và không kèm số chứng chỉ", () => {
    expect(certificateFileBaseName(undefined, { index: 1, typeLabel: "Căn cước công dân", title: "", expiryDate: null }, duc, "2026-10-28")).toBe("1. Căn cước công dân");
  });

  it("dùng tên gọi riêng của loại khi xuất (CCCD → ID)", () => {
    const config = { typeLabels: { "custom-ctype-cccd": "ID", atld: " " } };
    expect(certificateTypeLabel(config, "custom-ctype-cccd", typeNames)).toBe("ID");
    expect(certificateTypeLabel(config, "atld", typeNames)).toBe("An toàn lao động");
    expect(certificateTypeLabel(config, "health", typeNames)).toBe("health");
  });

  it("theo quy tắc tự đặt, bỏ dấu nối thừa khi biến trống", () => {
    const config = { filePattern: "{STT}. {loại chứng chỉ} - {tên chứng chỉ}" };
    expect(certificateFileBaseName(config, { index: 3, typeLabel: "ATLĐ", title: "Nhóm 3 - Điện", expiryDate: "2027-03-13" }, duc, "2026-10-28")).toBe("3. ATLĐ - Nhóm 3 - Điện");
    expect(certificateFileBaseName(config, { index: 1, typeLabel: "ID", title: "", expiryDate: null }, duc, "2026-10-28")).toBe("1. ID");
    expect(certificateFileBaseName({ filePattern: "{stt}_{mã nhân viên}_{ngày hết hạn}" }, { index: 2, typeLabel: "HĐLĐ", title: "", expiryDate: null }, duc, "2026-10-28")).toBe("2_TNM0018_Không thời hạn");
  });

  it("thư mục tổng và thư mục nhân sự", () => {
    expect(certificateRootFolderName(undefined, { templateName: "Vinci", count: 3, exportDate: "2026-10-28" })).toBe("Chứng chỉ - 28-10-2026");
    expect(certificateRootFolderName({ folderPattern: "{tên mẫu} - {số người} người - {ngày xuất}" }, { templateName: "Vinci", count: 3, exportDate: "2026-10-28" })).toBe("Vinci - 3 người - 28-10-2026");
    expect(employeeFolderName("Vinci - {mã nhân viên} - {tên nhân viên}", duc, "2026-10-28")).toBe("Vinci - TNM0018 - Trần Ngọc Đức");
    expect(employeeFolderName("", duc, "2026-10-28")).toBe("TNM0018 - Trần Ngọc Đức");
  });

  it("tên trùng trong một thư mục được thêm (2), (3)", () => {
    expect(uniqueFileNames(["ID.jpg", "ATLĐ.pdf", "atlđ.pdf", "ATLĐ.pdf", "Thư mục"])).toEqual(["ID.jpg", "ATLĐ.pdf", "atlđ (2).pdf", "ATLĐ (3).pdf", "Thư mục"]);
  });
});
