import { describe, expect, it } from "vitest";
import type { Certificate } from "../certificates/types";
import type { Employee } from "../employees/types";
import { certificateDigestTelegram, collectCertificateDigest, digestIdentity } from "./certificateDigest";

const employee = (patch: Partial<Employee>): Employee => ({
  id: "e1", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1",
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, ...patch,
});
const certificate = (patch: Partial<Certificate>): Certificate => ({
  id: "c1", employeeId: "e1", type: "atld", title: "", number: "ATLĐ-1", expiryDate: "2026-11-20", issueDate: "2024-01-01",
  document: { id: "f", name: "a.pdf", mime: "application/pdf", size: 1 }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null, ...patch,
});
const today = "2026-11-10";
const collect = (certificates: Certificate[], employees: Employee[]) =>
  collectCertificateDigest({ certificates, employees, certificateTypes: [], today, profileUrl: (id) => `https://tnm.com.vn/nhan-su/${id}` });

describe("bản tin chứng chỉ hằng ngày", () => {
  it("NOTI_01 đếm chứng chỉ đã hết hạn và còn ≤ 30 ngày của nhân sự đang làm, hạn gần nhất lên trước", () => {
    const people = [employee({}), employee({ id: "e2", code: "TNM002", name: "Trần Bình" }), employee({ id: "e3", code: "TNM003", status: "resigned" }), employee({ id: "e4", code: "TNM004", archivedAt: "2026-01-01T00:00:00Z" })];
    const digest = collect([
      certificate({ id: "soon", expiryDate: "2026-11-20" }),
      certificate({ id: "old", employeeId: "e2", expiryDate: "2025-01-01" }),
      certificate({ id: "edge", employeeId: "e2", expiryDate: "2026-12-10" }), // còn đúng 30 ngày
      certificate({ id: "far", expiryDate: "2026-12-11" }), // còn 31 ngày
      certificate({ id: "none", expiryDate: null }),
      certificate({ id: "replaced", expiryDate: "2026-11-11", state: "replaced" }),
      certificate({ id: "resigned", employeeId: "e3", expiryDate: "2026-11-11" }),
      certificate({ id: "archived", employeeId: "e4", expiryDate: "2026-11-11" }),
    ], people);
    expect(digest.items.map((item) => item.certificate.id)).toEqual(["old", "soon", "edge"]);
    expect(digest).toMatchObject({ expired: 1, expiring: 2, today });
    expect(digest.items[0]!.daysLeft).toBeLessThan(0);
    expect(digest.items[0]!.profileUrl).toBe("https://tnm.com.vn/nhan-su/e2");
  });

  it("NOTI_02 tin Telegram nêu tổng số, số đã hết hạn / sắp hết hạn và danh sách ngắn có ngày và số ngày còn lại", () => {
    const digest = collect([certificate({ expiryDate: "2026-11-20" }), certificate({ id: "c2", employeeId: "e2", expiryDate: "2026-11-05", type: "elec" })], [employee({}), employee({ id: "e2", code: "TNM002", name: "Trần <Bình> & Co" })]);
    const text = certificateDigestTelegram(digest, { appUrl: "https://tnm.com.vn/" });
    expect(text).toContain("<b>Bản tin chứng chỉ · 10/11/2026</b>");
    expect(text).toContain("Tổng: <b>2</b> chứng chỉ cần gia hạn");
    expect(text).toContain("Đã hết hạn: <b>1</b>");
    expect(text).toContain("Sắp hết hạn (≤ 30 ngày): <b>1</b>");
    expect(text).toContain("Trần &lt;Bình&gt; &amp; Co");
    expect(text).toContain("05/11/2026 (quá hạn 5 ngày)");
    expect(text).toContain("20/11/2026 (còn 10 ngày)");
    expect(text.indexOf("Trần")).toBeLessThan(text.indexOf("Nguyễn Minh An"));
    expect(text).toContain("Xem chi tiết: https://tnm.com.vn/canh-bao");
  });

  it("NOTI_02 danh sách dài bị cắt (tối đa 30 dòng, dưới 4.096 ký tự) kèm số còn lại; không có gì thì vẫn báo", () => {
    const people = Array.from({ length: 80 }, (_, index) => employee({ id: `e${index}`, code: `TNM${index}`, name: `Người số ${index} có họ tên rất dài để thử giới hạn độ dài tin nhắn` }));
    const digest = collect(people.map((person, index) => certificate({ id: `c${index}`, employeeId: person.id, expiryDate: "2026-11-15" })), people);
    const text = certificateDigestTelegram(digest);
    expect(text.length).toBeLessThan(4096);
    expect(text.match(/^\d+\. /gm)).toHaveLength(30);
    expect(text).toContain("… và 50 chứng chỉ khác.");
    expect(certificateDigestTelegram(digest, { maxLines: 5 })).toContain("… và 75 chứng chỉ khác.");

    const empty = certificateDigestTelegram(collect([], []), { note: "GỬI THỬ" });
    expect(empty).toContain("Không có chứng chỉ nào");
    expect(empty.startsWith("<i>GỬI THỬ</i>")).toBe(true);
  });

  it("NOTI_03 khóa chống gửi trùng theo ngày và nơi nhận", () => {
    expect(digestIdentity("2026-11-10", "telegram:t1")).toBe("certificate_digest|2026-11-10|telegram:t1");
    expect(digestIdentity("2026-11-10", "email")).not.toBe(digestIdentity("2026-11-11", "email"));
  });
});
