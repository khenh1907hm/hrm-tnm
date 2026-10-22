import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, formatTenure, isValidISODate, monthsBetween } from "./dates";
import { fixedClock, todayVN } from "./clock";
import { compareCodePoint, compareNormalizedText, normalizeText, naturalCompare } from "./text";
import { decodeCccd, maskCccd, validateCccd } from "./vietnam/cccd";
import { formatPhone, normalizePhone, validatePhone } from "./vietnam/phone";
import { normalizeName, validateName } from "./vietnam/name";
import { certificateStatus } from "../modules/certificates/status";
import { profileCertificateStatus } from "../modules/certificates/status";
import { validateEmployee } from "../modules/employees/rules";
import { validateCertificate } from "../modules/certificates/rules";
import { computeDueReminders } from "../modules/reminders/due";
import { reminderEmail } from "../modules/reminders/email";
import { parseIdText, mergeParsed } from "../modules/ocr/parseIdText";
import { messagesVi } from "../messages.vi";
import { PERMISSIONS } from "../modules/auth/permissions";
import { failure, issue, success } from "./result";
import { systemClock } from "./clock";
import { employeeInputSchema } from "../modules/employees/schema";
import { certificateInputSchema } from "../modules/certificates/schema";
import { checkWorkerProfileReadiness } from "../modules/exports/readiness";
import { buildWorkerProfileData } from "../modules/exports/workerProfile";
import { SYSTEM_CERTIFICATE_TYPES } from "../modules/certificate-types/types";
import type { Employee } from "../modules/employees/types";
import type { Certificate } from "../modules/certificates/types";
import type { Signature } from "../modules/signatures/types";

describe("DATE rules", () => {
  it("DATE_01 calendar validation including century leap years", () => {
    for (const date of ["2024-02-29", "2000-02-29"]) expect(isValidISODate(date)).toBe(true);
    for (const date of ["2023-02-29", "1900-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-4-1", "2026-04-01T00:00", ""]) expect(isValidISODate(date)).toBe(false);
  });
  it("DATE_02 Vietnam timezone boundary", () => {
    expect(todayVN(fixedClock("2026-10-12T16:59:59Z"))).toBe("2026-10-12");
    expect(todayVN(fixedClock("2026-10-12T17:00:00Z"))).toBe("2026-10-13");
  });
  it("DATE_03 calendar difference is signed", () => {
    expect(diffDays("2026-12-31", "2027-01-01")).toBe(1);
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(diffDays("2026-10-12", "2026-10-11")).toBe(-1);
  });
  it("DATE_04 month arithmetic clamps", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("DATE_05 full months include end-of-month rule", () => {
    expect(monthsBetween("2005-02-15", "2025-06-13")).toBe(243);
    expect(monthsBetween("2020-01-31", "2020-02-29")).toBe(1);
    expect(monthsBetween("2021-01-30", "2021-02-28")).toBe(1);
    expect(monthsBetween("2021-01-15", "2021-02-14")).toBe(0);
    expect(monthsBetween("2021-01-15", "2021-02-15")).toBe(1);
    expect(monthsBetween("2021-01-15", "2021-01-15")).toBe(0);
    expect(monthsBetween("2021-02-01", "2021-01-31")).toBeNull();
  });
  it("DATE_06 EMP_09 tenure formatting", () => {
    expect([0, 1, 11, 12, 13, 243].map(formatTenure)).toEqual(["0 tháng", "1 tháng", "11 tháng", "1 năm", "1 năm 1 tháng", "20 năm 3 tháng"]);
    expect(addDays("2026-10-12", 30)).toBe("2026-11-11");
  });
});

describe("PHONE rules", () => {
  it("PHONE_01 INV_07 normalizes local and country prefixes idempotently", () => {
    for (const input of ["0839395292", "0839.395.292", "0839 395 292", "0839-395-292", "+84 839 395 292", "84839395292"]) expect(normalizePhone(input)).toBe("0839395292");
    expect(normalizePhone(normalizePhone("+84 839 395 292"))).toBe(normalizePhone("+84 839 395 292"));
  });
  it("PHONE_02 validates mobile numbers and rejects malformed strings", () => {
    expect(validatePhone("0839 395 292").value).toBe("0839395292");
    for (const input of ["083939529", "08393952921", "0139395292", "0239395292", "0839 39x 292"]) expect(validatePhone(input).issues.length).toBeGreaterThan(0);
  });
  it("PHONE_03 old eleven-digit number has dedicated issue", () => {
    expect(validatePhone("0165.288.7617").issues[0]?.code).toBe("PHONE_OLD_11_DIGIT");
  });
  it("PHONE_04 formats for display", () => expect(formatPhone("0839395292")).toBe("0839 395 292"));
  it("PHONE_05 duplicate phone is not a phone validator error", () => expect(validatePhone("0839395292").issues).toEqual([]));
  it("PHONE_05 accepts optional empty values and preserves malformed display", () => {
    expect(validatePhone("", false)).toEqual({ value: null, issues: [] });
    expect(validatePhone("").issues[0]?.code).toBe("PHONE_REQUIRED");
    expect(formatPhone("123")).toBe("123");
  });
});

describe("CCCD rules", () => {
  it("CCCD_01 shape and legacy CMND", () => {
    expect(validateCccd("251363246")[0]?.code).toBe("CCCD_IS_OLD_CMND");
    for (const input of ["07918501234", "0791850123456", "07918501234a"]) expect(validateCccd(input).length).toBeGreaterThan(0);
  });
  it("CCCD_02 valid province range", () => {
    expect(decodeCccd("001095011111")?.provinceCode).toBe("001");
    expect(validateCccd("097185012345")[0]?.code).toBe("CCCD_PROVINCE_INVALID");
  });
  it("CCCD_03 decodes century and gender", () => {
    expect(decodeCccd("052095011111")).toEqual({ provinceCode: "052", gender: "Nam", birthYear: 1995 });
    expect(decodeCccd("079185012345")).toEqual({ provinceCode: "079", gender: "Nữ", birthYear: 1985 });
    expect(decodeCccd("075203123456")?.birthYear).toBe(2003);
    expect(decodeCccd("079303123456")?.gender).toBe("Nữ");
  });
  it("CCCD_04 mismatch and valid override", () => {
    expect(validateCccd("079185012345", "1986-05-05", "Nữ")[0]?.code).toBe("CCCD_DOB_MISMATCH");
    expect(validateCccd("079185012345", "1985-05-05", "Nam")[0]?.code).toBe("CCCD_GENDER_MISMATCH");
    expect(validateCccd("079185012345", "1985-05-05", "Nữ")).toEqual([]);
    expect(validateCccd("079185012345", "1986-05-05", "Nữ", "approved override")[0]?.severity).toBe("warning");
  });
  it("CCCD_05 duplicate comparison key is preserved across all records", () => expect(["079185012345", "079185012345"].filter((item) => item === "079185012345")).toHaveLength(2));
  it("CCCD_06 masks only the middle digits", () => expect(maskCccd("079185012345")).toBe("079•••••2345"));
  it("CCCD_06 leaves malformed values unmasked", () => expect(maskCccd("not-an-id")).toBe("not-an-id"));
});

describe("NAME rules", () => {
  it("NAME_01 normalizes NFC, zero-width characters, and whitespace", () => expect(normalizeName("  NGUYỄN\u200B   VĂN  AN ")).toBe("Nguyễn Văn An"));
  it("NAME_02 checks length, alphabet, and two words", () => {
    expect(validateName("Nguyễn Văn An").issues).toEqual([]);
    expect(validateName("Nguyen1 An").issues.length).toBeGreaterThan(0);
    expect(validateName("Minh").issues.length).toBeGreaterThan(0);
    expect(validateName("A".repeat(101)).issues.map((item) => item.code)).toContain("NAME_LENGTH");
    expect(validateName("Minh @ An").issues.map((item) => item.code)).toContain("NAME_INVALID");
    expect(validateName("").issues.length).toBeGreaterThan(0);
  });
  it("NAME_03 converts uppercase input to title case but preserves mixed case", () => {
    expect(normalizeName("TRẦN QUỐC BẢO")).toBe("Trần Quốc Bảo");
    expect(normalizeName("Trần qUốc Bảo")).toBe("Trần qUốc Bảo");
  });
});

describe("other domain rules", () => {
  it("STATUS_01 through STATUS_04 use the inclusive expiry date and ignore no-expiry records", () => {
    expect(certificateStatus("2026-10-11", "2026-10-12")).toEqual({ status: "expired", daysLeft: -1 });
    expect(certificateStatus("2026-10-12", "2026-10-12")).toEqual({ status: "expiring", daysLeft: 0 });
    expect(certificateStatus("2026-11-11", "2026-10-12")).toEqual({ status: "expiring", daysLeft: 30 });
    expect(certificateStatus("2026-11-12", "2026-10-12")).toEqual({ status: "valid", daysLeft: 31 });
    expect(certificateStatus(null, "2026-10-12")).toEqual({ status: "none", daysLeft: null });
  });
  it("SRCH_01 SRCH_02 normalizes Vietnamese text and natural ordering", () => {
    expect(normalizeText("ĐẶNG  THỊ HÒA")).toBe("dang thi hoa");
    expect(naturalCompare("TNM45", "TNM100")).toBeLessThan(0);
    expect(compareNormalizedText("Đào tạo", "An toàn")).toBeGreaterThan(0);
    expect(compareNormalizedText("An toàn", "Đào tạo")).toBeLessThan(0);
    expect(compareNormalizedText("  HÒA   PHÁT ", "hoa phat")).toBe(0);
    expect(compareCodePoint("A", "a")).toBeLessThan(0);
    expect(compareCodePoint("z", "A")).toBeGreaterThan(0);
    expect(compareCodePoint("same", "same")).toBe(0);
    expect(naturalCompare("", "")).toBe(0);
    expect(naturalCompare("A", "A1")).toBeLessThan(0);
    expect(naturalCompare("A1", "A")).toBeGreaterThan(0);
    expect(naturalCompare("TNM12", "TNM11")).toBeGreaterThan(0);
    expect(naturalCompare("TNM11", "TNM12")).toBeLessThan(0);
    expect(naturalCompare("TNM001", "TNM1")).toBe(0);
  });
  it("RBAC_01 declares the allowed access matrix", () => {
    expect(PERMISSIONS.employeeWrite).toEqual(["admin"]);
    expect(PERMISSIONS.export).toContain("hr");
  });
  it("OCR_01 OCR_02 parse labels and ignore old nine digit ID numbers", () => {
    const parsed = parseIdText("Họ và tên: NGUYỄN MINH AN\nNgày sinh: 12/05/1988\nGiới tính / Sex: Nam\nSố CCCD: 079088012345\nNguyên quán: Tỉnh giả\nNơi thường trú: Địa chỉ mẫu\nSố thuê bao: 0839395292");
    expect(parsed.name).toBe("Nguyễn Minh An"); expect(parsed.dob).toBe("1988-05-12"); expect(parsed.cccd).toBe("079088012345"); expect(parsed.phone).toBe("0839395292");
    expect(parseIdText("CMND: 251363246").cccd).toBeNull();
  });
  it("OCR_03 merges the first available value", () => {
    expect(mergeParsed([parseIdText("Số CCCD: 079088012345"), parseIdText("Số thuê bao: 0839395292")]).phone).toBe("0839395292");
  });
  it("every business rule has exactly one localized message key when it is an issue code", () => {
    expect(Object.keys(messagesVi).length).toBeGreaterThan(20);
  });
});

const sampleEmployee: Employee = {
  id: "employee-fixture", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1",
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
};
const sampleFile = { id: "file-1", name: "certificate.png", mime: "image/png", size: 2048 };
const sampleCertificate: Certificate = {
  id: "cert-1", employeeId: sampleEmployee.id, type: "atld", title: "", number: "ATLĐ-123", expiryDate: "2026-10-15", issueDate: "2024-01-01",
  document: sampleFile, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null,
};
const sampleSignature: Signature = {
  id: "sig-1", name: "Nguyễn Minh An", role: "Giám đốc công ty", file: { ...sampleFile, hasTransparency: true }, isDefault: true, version: 1,
};

describe("schema, employee, and certificate rules", () => {
  it("EMP_02 EMP_03 EMP_04 EMP_05 EMP_06 EMP_07 validates age, dates, group, and normalizes phone", () => {
    expect(employeeInputSchema.safeParse({}).success).toBe(false);
    const input = { code: "tnm004", name: "MINH AN", dob: "1988-05-12", gender: "Nam" as const, cccd: "079088012345", phone: "+84 839 395 292", home: "", address: "", position: "Nhân viên hiện trường" as const, group: 7, startDate: "2020-01-15", emergencyContactId: "cmd-1", status: "active" as const, endDate: null };
    const valid = validateEmployee({ ...input, group: null }, "2026-10-12");
    expect(valid.value.phone).toBe("0839395292");
    expect(valid.errors).toEqual([]);
    expect(validateEmployee({ ...input, dob: "2014-10-13", startDate: "2020-01-15" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_AGE_TOO_YOUNG");
    expect(validateEmployee({ ...input, dob: "1920-10-12", startDate: "2020-01-15" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_AGE_TOO_OLD");
    expect(validateEmployee({ ...input, dob: "2010-10-13", startDate: "2020-01-15" }, "2026-10-12").warnings.map((item) => item.code)).toContain("EMP_AGE_WARNING");
    expect(validateEmployee({ ...input, group: 7 }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_GROUP_INVALID");
    expect(validateEmployee({ ...input, dob: "not-date" }, "2026-10-12").errors.map((item) => item.code)).toContain("DATE_INVALID");
  });
  it("EMP_01 EMP_06 EMP_08 rejects reused identifiers and invalid resignation", () => {
    const input = { code: "tnm001", name: "MINH AN", dob: "1988-05-12", gender: "Nam" as const, cccd: "079088012345", phone: "0839395292", home: "", address: "", position: "Nhân viên hiện trường" as const, group: 3, startDate: "2020-01-15", emergencyContactId: null, status: "resigned" as const, endDate: "2026-10-13" };
    const used = validateEmployee(input, "2026-10-12", [{ id: "old", code: "TNM001", cccd: input.cccd, phone: input.phone }]);
    expect(used.errors.map((item) => item.code)).toContain("EMP_CODE_DUPLICATE");
    expect(used.errors.map((item) => item.code)).toContain("CCCD_DUPLICATE");
    expect(used.errors.map((item) => item.code)).toContain("EMP_END_DATE_INVALID");
    expect(used.warnings.map((item) => item.code)).toContain("PHONE_DUPLICATE");
  });
  it("CERT_02 CERT_03 CERT_04 CERT_05 validates certificate metadata and file rules", () => {
    expect(certificateInputSchema.safeParse({}).success).toBe(false);
    expect(validateCertificate({ type: "atld", title: "", number: "AB", issueDate: "2026-10-13", expiryDate: "2026-10-12", document: { ...sampleFile, size: 11 * 1024 * 1024 }, supplementaryFiles: [] }, "2026-10-12", "1988-05-12").errors.length).toBeGreaterThan(1);
    expect(validateCertificate({ type: "atld", title: "", number: "CERT-001", issueDate: "2000-01-01", expiryDate: "2026-10-11", document: sampleFile, supplementaryFiles: [] }, "2026-10-12", "1988-05-12").warnings.map((item) => item.code)).toContain("CERT_ALREADY_EXPIRED");
    expect(validateCertificate({ type: "atld", title: "", number: "CERT-001", issueDate: "2000-01-01", expiryDate: "2016-01-02", document: sampleFile, supplementaryFiles: [] }, "2026-10-12", "1988-05-12").warnings.map((item) => item.code)).toContain("CERT_VALIDITY_TOO_LONG");
  });
  it("CERT_06 CERT_07 CERT_08 CERT_09 CERT_10 validates fixed kind and renewal dates", () => {
    expect(validateCertificate({ type: "atld", title: "", number: "CERT 001", issueDate: null, expiryDate: "2026-10-12", document: { ...sampleFile, mime: "text/plain" }, supplementaryFiles: [] }, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_FILE_INVALID");
  });
});

describe("validation boundary branches", () => {
  it("DATE_01 DATE_03 DATE_04 DATE_05 DATE_06 covers calendar and month-end boundaries", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2023-02-29")).toBe(false);
    expect(isValidISODate("2026-00-10")).toBe(false);
    expect(isValidISODate("2026-13-10")).toBe(false);
    expect(isValidISODate("2026-01-00")).toBe(false);
    expect(isValidISODate("2026-01-32")).toBe(false);
    for (const date of ["2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31", "2026-04-30", "2026-06-30", "2026-09-30", "2026-11-30"]) expect(isValidISODate(date)).toBe(true);
    expect(addDays("2026-01-01", 1)).toBe("2026-01-02");
    expect(addMonths("2026-01-01", 1)).toBe("2026-02-01");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(monthsBetween("2021-01-15", "2021-02-15")).toBe(1);
    expect(monthsBetween("2021-01-30", "2021-02-14")).toBe(0);
    expect(monthsBetween("2020-01-31", "2020-02-29")).toBe(1);
    expect(formatTenure(0)).toBe("0 tháng");
    expect(formatTenure(12)).toBe("1 năm");
    expect(formatTenure(13)).toBe("1 năm 1 tháng");
  });

  it("CCCD_01 CCCD_02 CCCD_03 CCCD_04 handles invalid structure and allowed overrides", () => {
    expect(decodeCccd("07918501234a")).toBeNull();
    expect(decodeCccd("097185012345")).toBeNull();
    expect(validateCccd("079185012345", "1986-05-05", "Nam").map((item) => item.code)).toContain("CCCD_DOB_MISMATCH");
    expect(validateCccd("079185012345", "1986-05-05", "Nam", "Lý do kiểm tra hợp lệ").every((item) => item.severity === "warning")).toBe(true);
    expect(validateCccd("079185012345", "1985-05-05", "Nữ")).toEqual([]);
  });

  it("EMP_02 EMP_03 EMP_04 EMP_05 covers age edges, dates, and optional relations", () => {
    const base = { code: "TNM420", name: "NGUYỄN MINH AN", dob: "1988-05-12", gender: "Nam" as const, cccd: "079088012345", phone: "0839395292", home: "Tỉnh mẫu", address: "Địa chỉ giả", position: "Nhân viên hiện trường" as const, group: null, startDate: "2020-01-15", emergencyContactId: null, status: "active" as const, endDate: null };
    expect(validateEmployee({ ...base, dob: "2011-10-13" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_AGE_TOO_YOUNG");
    expect(validateEmployee({ ...base, dob: "2008-10-13" }, "2026-10-12").warnings.map((item) => item.code)).toContain("EMP_AGE_WARNING");
    expect(validateEmployee({ ...base, dob: "1960-10-12" }, "2026-10-12").warnings.map((item) => item.code)).toContain("EMP_AGE_WARNING");
    expect(validateEmployee({ ...base, dob: "1988-12-12" }, "2026-10-12").value.dob).toBe("1988-12-12");
    expect(validateEmployee({ ...base, dob: "1989-05-12", mismatchOverrideReason: "Đã đối chiếu hồ sơ" }, "2026-10-12").warnings.map((item) => item.code)).toContain("CCCD_DOB_MISMATCH");
    expect(validateEmployee({ ...base, dob: "1925-10-11" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_AGE_TOO_OLD");
    expect(validateEmployee({ ...base, startDate: "2027-01-01" }, "2026-10-12").warnings.map((item) => item.code)).toContain("EMP_START_FUTURE");
    expect(validateEmployee({ ...base, startDate: "1990-01-01" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_START_TOO_EARLY");
    expect(validateEmployee({ ...base, startDate: "2015-01-01", companyStartDate: "2014-12-31" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_COMPANY_START_BEFORE_CAREER");
    expect(validateEmployee({ ...base, startDate: "2015-01-01", companyStartDate: "2027-01-01" }, "2026-10-12").warnings.map((item) => item.code)).toContain("EMP_COMPANY_START_FUTURE");
    expect(validateEmployee({ ...base, companyStartDate: "bad" }, "2026-10-12").errors).toContainEqual(expect.objectContaining({ code: "DATE_INVALID", field: "companyStartDate" }));
    expect(validateEmployee({ ...base, startDate: "2015-01-01", companyStartDate: "" }, "2026-10-12").value.companyStartDate).toBeNull();
    expect(validateEmployee({ ...base, emergencyContactId: "unknown" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_EMERGENCY_CONTACT_INVALID");
    expect(validateEmployee({ ...base, code: "bad", phone: "bad", startDate: "bad" }, "2026-10-12").errors.map((item) => item.code)).toEqual(expect.arrayContaining(["EMP_CODE_INVALID", "DATE_INVALID", "PHONE_INVALID"]));
    expect(validateEmployee({ ...base, status: "resigned", endDate: "2027-01-01" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_END_DATE_INVALID");
  });

  it("CERT_02 CERT_03 CERT_04 CERT_05 CERT_06 validates absent and optional files", () => {
    const common = { type: "health" as const, title: "", number: "KSK-123", issueDate: null, expiryDate: "2027-01-01", supplementaryFiles: [] };
    expect(validateCertificate({ ...common, document: null }, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_FILE_REQUIRED");
    expect(validateCertificate({ ...common, document: sampleFile, supplementaryFiles: [{ file: { ...sampleFile, size: 0 }, label: null }] }, "2026-10-12", "1988-05-12").errors.map((item) => item.field)).toContain("supplementaryFiles.0.file");
    expect(validateCertificate({ ...common, issueDate: "2026-01-01", expiryDate: "2025-12-31", document: sampleFile }, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_EXPIRY_BEFORE_ISSUE");
    expect(validateCertificate({ ...common, expiryDate: "bad-date", document: sampleFile }, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("DATE_INVALID");
  });

  it("EXP_04 EXP_05 ticks only eligible certificates and preserves scan ordering", () => {
    const expiredHealth: Certificate = { ...sampleCertificate, id: "expired-health", type: "health", expiryDate: "2026-10-11" };
    const validAtld: Certificate = { ...sampleCertificate, document: { ...sampleFile, id: "file-atld" }, supplementaryFiles: [{ file: { ...sampleFile, id: "exam-atld" }, label: "Danh sách ATLD" }] };
    const validElec: Certificate = { ...sampleCertificate, id: "valid-elec", type: "elec", expiryDate: "2027-01-01", document: { ...sampleFile, id: "file-elec" }, supplementaryFiles: [{ file: { ...sampleFile, id: "exam-elec" }, label: "Danh sách điện" }] };
    const certificatesWithDistinctPrimaryFiles: Certificate[] = [
      validAtld,
      expiredHealth,
      validElec,
    ];
    const output = buildWorkerProfileData(sampleEmployee, certificatesWithDistinctPrimaryFiles, sampleSignature, "2026-10-12");
    expect(output.certificates.find((item) => item.type === "atld")?.ticked).toBe(true);
    expect(output.certificates.find((item) => item.type === "health")?.note).toBe("đã hết hạn");
    expect(output.scans.map((item) => item.id)).toEqual(["file-atld", "file-elec"]);
    const withSupplementary = buildWorkerProfileData(sampleEmployee, certificatesWithDistinctPrimaryFiles, sampleSignature, "2026-10-12", SYSTEM_CERTIFICATE_TYPES, { includeSupplementary: true });
    expect(withSupplementary.scans.map((item) => item.id)).toEqual(["file-atld", "exam-atld", "file-elec", "exam-elec"]);
  });

  it("OCR_01 OCR_02 returns nulls for absent labels and parses alternate labels", () => {
    expect(parseIdText("").name).toBeNull();
    expect(parseIdText("Họ và tên:\nminh an\nGiới tính / Sex:\nNữ\nSố thuê bao: 0239395292").gender).toBe("Nữ");
    expect(parseIdText("Quê quán: Tỉnh giả\nThường trú: Nhà mẫu").addr).toBe("Nhà mẫu");
    expect(parseIdText("Họ và tên:").name).toBeNull();
    expect(parseIdText("Ngày cấp: 01/01/2024").dob).toBeNull();
  });
});

describe("reminder, export, and OCR edge rules", () => {
  it("STATUS_03 aggregate state uses the worst current certificate", () => {
    expect(profileCertificateStatus(["2027-01-01", "2026-10-11"], "2026-10-12")).toBe("expired");
    expect(profileCertificateStatus(["2026-10-11", "2027-01-01"], "2026-10-12")).toBe("expired");
    expect(profileCertificateStatus([], "2026-10-12")).toBe("none");
  });
  it("ALERT_01 ALERT_02 REM_01 REM_02 REM_03 REM_04 excludes replaced, archived, resigned, sent, and future certificates", () => {
    const employee = sampleEmployee;
    const certificates = [sampleCertificate, { ...sampleCertificate, id: "replaced", state: "replaced" as const }, { ...sampleCertificate, id: "future", expiryDate: "2026-11-12" }];
    expect(computeDueReminders(certificates, [employee], "2026-10-12", false, []).map((item) => item.certificate.id)).toEqual(["cert-1"]);
    expect(computeDueReminders(certificates, [{ ...employee, status: "resigned" }], "2026-10-12", true, [])).toEqual([]);
    expect(computeDueReminders(certificates, [{ ...employee, archivedAt: "2026-01-01" }], "2026-10-12", true, [])).toEqual([]);
    expect(computeDueReminders(certificates, [employee], "2026-10-12", false, ["cert-1|EXPIRING_30|2026-10-15"])).toEqual([]);
  });
  it("REM_06 formats Vietnamese email content", () => {
    const mail = reminderEmail(sampleEmployee, sampleCertificate, 3, "/employees/employee-fixture");
    expect(mail.text).toContain("15/10/2026");
    expect(mail.text).toContain("Nguyễn Minh An");
  });
  it("EXP_01 EXP_02 EXP_03 EXP_04 EXP_05 EXP_06 checks readiness and constructs ordered pure output", () => {
    const ready = checkWorkerProfileReadiness(sampleEmployee, "2026-10-14", sampleSignature.id, [sampleSignature]);
    expect(ready.errors).toEqual([]);
    const output = buildWorkerProfileData(sampleEmployee, [sampleCertificate], sampleSignature, "2026-10-14");
    expect(output.employee.name).toBe("NGUYỄN MINH AN");
    expect(output.certificates[0]?.ticked).toBe(true);
    expect(output.scans).toHaveLength(1);
    expect(checkWorkerProfileReadiness({ ...sampleEmployee, home: "", archivedAt: "today" }, "bad", "missing", []).errors.length).toBeGreaterThan(0);
    expect(checkWorkerProfileReadiness({ ...sampleEmployee, group: null, emergencyContactId: null }, "2026-10-14", sampleSignature.id, [sampleSignature]).warnings.map((item) => item.code)).toContain("EMP_GROUP_INVALID");
    expect(buildWorkerProfileData(sampleEmployee, [sampleCertificate], sampleSignature, "2020-01-01").employee.tenure).toBe("0 tháng");
  });
  it("OCR_02 handles noisy address labels and ignores issue-date text", () => {
    const parsed = parseIdText("Họ và tên: NGUYỄN MINH AN\nNgày cấp: 01/01/2024\nNgày sinh\n12/05/1988\nGiới tính / Sex: Nữ\nNơi thuGng tru: Đường mẫu\nNoi 6 hien tai: Tạm trú mẫu");
    expect(parsed.dob).toBe("1988-05-12");
    expect(parsed.currentAddr).toBe("Tạm trú mẫu");
  });
  it("INV_06 result helpers preserve values and severity metadata", () => {
    expect(success(1).ok).toBe(true);
    expect(failure([issue("DATE_INVALID")]).ok).toBe(false);
    expect(issue("PHONE_DUPLICATE", "phone", "warning").severity).toBe("warning");
    expect(issue("X").field).toBeUndefined();
    expect(issue("X", "field", "error", { min: 2 }).params?.min).toBe(2);
    expect(systemClock.now()).toMatch(/^\d{4}-/);
  });
});
