import { describe, expect, it } from "vitest";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";
import { reminderDigestEmail, type ReminderEmailItem } from "./email";

const employee = (patch: Partial<Employee>): Employee => ({
  id: "e1", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1",
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, ...patch,
});
const certificate = (patch: Partial<Certificate>): Certificate => ({
  id: "c1", employeeId: "e1", type: "atld", title: "", number: "ATLĐ-123", expiryDate: "2026-10-15", issueDate: "2024-01-01",
  document: { id: "f", name: "a.pdf", mime: "application/pdf", size: 1 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null, ...patch,
});
const item = (patch: Partial<ReminderEmailItem>): ReminderEmailItem => ({ employee: employee({}), certificate: certificate({}), daysLeft: 3, profileUrl: "https://hrm-tnm.vercel.app/nhan-su/e1", ...patch });

describe("email nhắc hạn tổng hợp", () => {
  it("REM_06 một email cho nhiều người: bảng ngang mỗi chứng chỉ một dòng, hạn gần nhất lên trước, mỗi dòng có nút mở hồ sơ", () => {
    const mail = reminderDigestEmail([
      item({}),
      item({ employee: employee({ id: "e2", code: "TNM002", name: "Trần Bình" }), certificate: certificate({ id: "c2", employeeId: "e2", number: "HN-9", expiryDate: "2026-10-10", type: "elec" }), daysLeft: -2, profileUrl: "https://hrm-tnm.vercel.app/nhan-su/e2" }),
    ], { today: "2026-10-12" });
    expect(mail.subject).toBe("Nhắc hạn chứng chỉ: 2 chứng chỉ cần gia hạn (1 đã hết hạn, 1 sắp hết hạn) · 12/10/2026");
    expect(mail.html).toContain(">Nhân sự</th><th");
    expect(mail.html.indexOf("Trần Bình")).toBeLessThan(mail.html.indexOf("Nguyễn Minh An"));
    for (const value of ["TNM001", "TNM002", "Nhân viên hiện trường", "ATLĐ-123", "HN-9", "15/10/2026", "10/10/2026", "Còn 3 ngày", "Quá hạn 2 ngày"]) expect(mail.html).toContain(value);
    expect(mail.html.match(/>Mở hồ sơ<\/a>/g)).toHaveLength(2);
    expect(mail.html).toContain('href="https://hrm-tnm.vercel.app/nhan-su/e2"');
    expect(mail.text).toContain("1. Trần Bình (TNM002)");
    expect(mail.text).toContain("2. Nguyễn Minh An (TNM001)");
  });

  it("REM_06 không gắn nút khi chỉ có đường dẫn tương đối, và không để tên nhân sự chèn mã HTML", () => {
    const mail = reminderDigestEmail([item({ employee: employee({ name: "<b>An</b>" }), profileUrl: "/nhan-su/e1" })], { today: "2026-10-12", note: "Gửi thử" });
    expect(mail.html).not.toContain("<a href=");
    expect(mail.html).toContain("&lt;b&gt;An&lt;/b&gt;");
    expect(mail.text.startsWith("Gửi thử")).toBe(true);
  });
});
