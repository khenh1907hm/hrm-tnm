import { describe, expect, it } from "vitest";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";
import { reminderEmail } from "./email";

const employee: Employee = {
  id: "e1", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1",
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
};
const certificate: Certificate = {
  id: "c1", employeeId: "e1", type: "atld", title: "", number: "ATLĐ-123", expiryDate: "2026-10-15", issueDate: "2024-01-01",
  document: { id: "f", name: "a.pdf", mime: "application/pdf", size: 1 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null,
};

describe("email nhắc hạn", () => {
  it("REM_06 bảng chi tiết (nhân sự, chức danh, số, ngày cấp, ngày hết hạn dd/mm/yyyy, số ngày còn lại) và nút mở hồ sơ", () => {
    const mail = reminderEmail(employee, certificate, 3, "https://hrm-tnm.vercel.app/nhan-su/e1");
    expect(mail.subject).toBe("Nhắc hạn chứng chỉ An toàn lao động · Nguyễn Minh An (TNM001) · còn 3 ngày");
    for (const value of ["Nguyễn Minh An", "TNM001", "Nhân viên hiện trường", "0839395292", "ATLĐ-123", "01/01/2024", "15/10/2026", "Còn 3 ngày nữa hết hạn"]) {
      expect(mail.html).toContain(value);
      expect(mail.text).toContain(value === "Còn 3 ngày nữa hết hạn" ? value.toUpperCase() : value);
    }
    expect(mail.html).toContain('<a href="https://hrm-tnm.vercel.app/nhan-su/e1"');
    expect(mail.html).toContain("Mở hồ sơ nhân sự");
    expect(mail.text).toContain("Mở hồ sơ: https://hrm-tnm.vercel.app/nhan-su/e1");
  });

  it("REM_06 không gắn nút khi chỉ có đường dẫn tương đối, và không để tên nhân sự chèn mã HTML", () => {
    const mail = reminderEmail({ ...employee, name: "<b>An</b>" }, certificate, -2, "/nhan-su/e1", undefined, { note: "Gửi thử" });
    expect(mail.html).not.toContain("<a href=");
    expect(mail.html).toContain("&lt;b&gt;An&lt;/b&gt;");
    expect(mail.html).toContain("Đã hết hạn 2 ngày");
    expect(mail.html).toContain("#991b1b");
    expect(mail.text.startsWith("Gửi thử")).toBe(true);
    expect(mail.subject.endsWith("quá hạn 2 ngày")).toBe(true);
  });
});
