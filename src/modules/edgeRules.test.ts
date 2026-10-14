import { describe, expect, it } from "vitest";
import type { Certificate } from "./certificates/types";
import { validateCertificate } from "./certificates/rules";
import { certificateStatus, profileCertificateStatus } from "./certificates/status";
import type { Employee, EmployeeInput } from "./employees/types";
import { validateEmployee } from "./employees/rules";
import { checkWorkerProfileReadiness } from "./exports/readiness";
import { buildWorkerProfileData } from "./exports/workerProfile";
import { SYSTEM_CERTIFICATE_TYPES } from "./certificate-types/types";
import { computeDueReminders } from "./reminders/due";
import type { Signature } from "./signatures/types";
import { parseIdText, mergeParsed } from "./ocr/parseIdText";

const employeeInput: EmployeeInput = {
  code: "TNM420", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh giả", address: "Địa chỉ giả", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15",
  emergencyContactId: "cmd-1", status: "active", endDate: null,
};
const employee: Employee = { ...employeeInput, id: "worker-1", version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null };
const file = { id: "file-1", name: "certificate.pdf", mime: "application/pdf", size: 1024 };
const certificate: Certificate = { id: "cert-1", employeeId: employee.id, type: "atld", title: "", number: "SAFE-123", issueDate: "2024-01-01", expiryDate: "2026-10-15", document: file, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null };
const signature: Signature = { id: "sig-1", name: "Nguyễn Minh An", role: "Giám đốc", file: { ...file, mime: "image/png", hasTransparency: true }, isDefault: true, version: 1 };
const codes = (input: Partial<EmployeeInput>, existing?: { code: string; cccd: string; phone: string; id?: string }[]) => validateEmployee({ ...employeeInput, ...input }, "2026-10-12", existing);

describe("employee validation edge cases", () => {
  it("EMP_01 EMP_04 checks exact age and birthday boundaries", () => {
    expect(codes({ dob: "2011-10-12" }).errors.map((item) => item.code)).not.toContain("EMP_AGE_TOO_YOUNG");
    expect(codes({ dob: "2008-10-12" }).warnings.map((item) => item.code)).not.toContain("EMP_AGE_WARNING");
    expect(codes({ dob: "1961-10-12" }).warnings.map((item) => item.code)).not.toContain("EMP_AGE_WARNING");
    expect(codes({ dob: "1926-10-12" }).errors.map((item) => item.code)).not.toContain("EMP_AGE_TOO_OLD");
    expect(codes({ dob: "1988-10-13" }).value.dob).toBe("1988-10-13");
    expect(codes({ code: "TNM42" }).errors.map((item) => item.code)).toContain("EMP_CODE_INVALID");
  });

  it("EMP_01 EMP_06 EMP_07 detects all global duplicates and excludes the edited record", () => {
    const used = [{ id: "other", code: "TNM420", cccd: employeeInput.cccd, phone: employeeInput.phone }];
    const result = codes({}, used);
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["EMP_CODE_DUPLICATE", "CCCD_DUPLICATE"]));
    expect(result.warnings.map((item) => item.code)).toContain("PHONE_DUPLICATE");
    expect(codes({}, used).errors).toHaveLength(2);
    expect(validateEmployee(employeeInput, "2026-10-12", used, "other").errors).toEqual([]);
  });

  it("EMP_02 EMP_03 EMP_04 EMP_05 covers optional fields, CCCD overrides, and resignation dates", () => {
    expect(codes({ name: "A" }).errors.map((item) => item.code)).toContain("NAME_LENGTH");
    expect(codes({ position: "Nhân sự" }).errors).toEqual([]);
    expect(codes({ emergencyContactId: "missing" }).errors.map((item) => item.code)).toContain("EMP_EMERGENCY_CONTACT_INVALID");
    expect(codes({ dob: "1989-05-12" }).errors.map((item) => item.code)).toContain("CCCD_DOB_MISMATCH");
    expect(codes({ dob: "1989-05-12", mismatchOverrideReason: "đã đối chiếu" }).warnings.map((item) => item.code)).toContain("CCCD_DOB_MISMATCH");
    expect(codes({ group: 1 }).errors.map((item) => item.code)).not.toContain("EMP_GROUP_INVALID");
    expect(codes({ group: 6 }).errors.map((item) => item.code)).not.toContain("EMP_GROUP_INVALID");
    expect(codes({ group: 0 }).errors.map((item) => item.code)).toContain("EMP_GROUP_INVALID");
    for (const endDate of [null, "bad-date", "2019-01-01", "2026-10-13"]) {
      expect(codes({ status: "resigned", endDate }).errors.map((item) => item.code)).toContain("EMP_END_DATE_INVALID");
    }
    expect(codes({ status: "resigned", endDate: "2026-10-12" }).errors.map((item) => item.code)).not.toContain("EMP_END_DATE_INVALID");
  });
});

describe("certificate validation and status boundaries", () => {
  it("CERT_02 CERT_03 CERT_04 CERT_05 checks number, issue date, expiry, and file limits", () => {
    const valid = { type: "atld" as const, title: "", number: "SAFE-123", issueDate: "2024-01-01", expiryDate: "2026-10-12", document: file, supplementaryFiles: [] };
    expect(validateCertificate({ ...valid, number: "AB" }, "2026-10-12", employee.dob).errors.map((item) => item.code)).toContain("CERT_NUMBER_INVALID");
    for (const issueDate of ["bad-date", "2026-10-13", "1988-05-11"]) {
      expect(validateCertificate({ ...valid, issueDate }, "2026-10-12", employee.dob).errors.map((item) => item.code)).toContain("CERT_ISSUE_DATE_INVALID");
    }
    expect(validateCertificate({ ...valid, issueDate: "2024-01-01", expiryDate: "2023-12-31" }, "2026-10-12", employee.dob).errors.map((item) => item.code)).toContain("CERT_EXPIRY_BEFORE_ISSUE");
    expect(validateCertificate({ ...valid, issueDate: "2000-01-01", expiryDate: "2015-01-02" }, "2026-10-12", employee.dob).warnings.map((item) => item.code)).toContain("CERT_VALIDITY_TOO_LONG");
    expect(validateCertificate({ ...valid, expiryDate: "2026-10-11" }, "2026-10-12", employee.dob).warnings.map((item) => item.code)).toContain("CERT_ALREADY_EXPIRED");
    expect(validateCertificate({ ...valid, document: { ...file, mime: "text/plain" } }, "2026-10-12", employee.dob).errors.map((item) => item.field)).toContain("document");
    expect(validateCertificate({ ...valid, document: { ...file, size: 10 * 1024 * 1024 } }, "2026-10-12", employee.dob).errors).toEqual([]);
  });

  it("STATUS_01 STATUS_02 STATUS_03 STATUS_04 returns exact inclusive day groups", () => {
    expect(certificateStatus("2026-10-11", "2026-10-12")).toEqual({ status: "expired", daysLeft: -1 });
    expect(certificateStatus("2026-10-12", "2026-10-12")).toEqual({ status: "expiring", daysLeft: 0 });
    expect(certificateStatus("2026-11-11", "2026-10-12")).toEqual({ status: "expiring", daysLeft: 30 });
    expect(certificateStatus("2026-11-12", "2026-10-12")).toEqual({ status: "valid", daysLeft: 31 });
    expect(profileCertificateStatus(["2027-01-01", "2026-11-01"], "2026-10-12")).toBe("expiring");
    expect(profileCertificateStatus(["2026-10-11", "2027-01-01"], "2026-10-12")).toBe("expired");
  });
});

describe("reminder, export, and OCR edge cases", () => {
  it("REM_01 REM_02 REM_03 REM_04 selects once by status, date, and employee state", () => {
    const due = (cert: Certificate, worker: Employee = employee, expiredNotice = false, sent: string[] = []) => computeDueReminders([cert], [worker], "2026-10-12", expiredNotice, sent);
    expect(due({ ...certificate, expiryDate: "2026-11-12" })).toHaveLength(0);
    expect(due(certificate)).toHaveLength(1);
    expect(due(certificate, employee, false, [`cert-1|${"EXPIRING"}_30|2026-10-15`])).toHaveLength(0);
    expect(due({ ...certificate, expiryDate: "2026-10-11" })).toHaveLength(0);
    expect(due({ ...certificate, expiryDate: "2026-10-11" }, employee, true)).toHaveLength(1);
    expect(due(certificate, { ...employee, status: "on_leave" })).toHaveLength(1);
    expect(due(certificate, { ...employee, status: "resigned" }, true)).toHaveLength(0);
    expect(due(certificate, { ...employee, archivedAt: "2026-01-01" }, true)).toHaveLength(0);
    expect(due({ ...certificate, state: "replaced" })).toHaveLength(0);
    expect(computeDueReminders([certificate], [], "2026-10-12", false, [])).toHaveLength(0);
  });

  it("EXP_01 EXP_02 EXP_03 blocks missing fields and checks signer and archive", () => {
    const result = checkWorkerProfileReadiness({ ...employee, name: "", home: "", address: "", phone: "", emergencyContactId: null, group: null, archivedAt: "2026-01-01" }, "invalid", "missing", []);
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["EMP_NOT_READY", "EXPORT_FIELD_REQUIRED", "SIGN_DATE_INVALID", "SIGNATURE_NOT_FOUND"]));
    expect(result.warnings.map((item) => item.code)).toContain("EMP_GROUP_INVALID");
    expect(checkWorkerProfileReadiness(employee, "2026-10-12", signature.id, [signature]).errors).toEqual([]);
  });

  it("EXP_04 EXP_05 checks expiry on signing day and ordered scan attachments", () => {
    expect(buildWorkerProfileData(employee, [certificate], signature, "2026-10-14").certificates.find((item) => item.type === "atld")?.ticked).toBe(true);
    expect(buildWorkerProfileData(employee, [certificate], signature, "2026-10-15").certificates.find((item) => item.type === "atld")?.ticked).toBe(true);
    const expired = buildWorkerProfileData(employee, [certificate], signature, "2026-10-16");
    expect(expired.certificates.find((item) => item.type === "atld")?.note).toBe("đã hết hạn");
    expect(expired.scans).toHaveLength(0);
    const withExam: Certificate = { ...certificate, supplementaryFiles: [{ file: { ...file, id: "exam-1" }, label: "Tài liệu bổ sung" }] };
    expect(buildWorkerProfileData(employee, [withExam], signature, "2026-10-14").scans.map((item) => item.id)).toEqual(["file-1"]);
    expect(buildWorkerProfileData(employee, [withExam], signature, "2026-10-14", SYSTEM_CERTIFICATE_TYPES, { includeSupplementary: true }).scans.map((item) => item.id)).toEqual(["file-1", "exam-1"]);
  });

  it("OCR_01 OCR_02 OCR_03 OCR_04 reads multiline fake fields and validates dates", () => {
    const parsed = parseIdText("Họ và tên: NGUYỄN MINH AN\nNgày cấp: 01/01/2024\nNgày sinh: 12/05/1988\nGiới tính / Sex: Nam\nSố CCCD: 079088012345\nNguyên quán: Tỉnh giả\nNơi thường trú:\nSố 1, Đường mẫu\nPhường giả\nSố thuê bao: 0839395292");
    expect(parsed.dob).toBe("1988-05-12");
    expect(parsed.addr).toBe("Số 1, Đường mẫu Phường giả");
    expect(parseIdText("Ngày sinh: 31/02/1988").dob).toBeNull();
    expect(parseIdText("Giới tính / Sex: không rõ").gender).toBeNull();
    expect(parseIdText("Nơi thường trú:").addr).toBeNull();
    expect(mergeParsed([parseIdText("Số CCCD: 079088012345"), parsed]).cccd).toBe("079088012345");
  });

  it("OCR_05 merges two synthetic VNeID-side texts with noisy and misread labels", () => {
    const front = parseIdText("Dòng nhiễu: ###\nHọ và tên: NGUYỄN MINH AN\nNgày sinh: 12/05/1988\nGiới tính / Sex: Nam\nSố CCCD: 079088012345\nNguyên quán: Tỉnh giả\nNơi thường trú: Đường mẫu\nGiới tinh / Sex: ???");
    const back = parseIdText("Số thuê bao: 0839395292\nNhãn lỗi: xxxxxxxxx\nGhi chú: dữ liệu giả");
    const merged = mergeParsed([front, back]);
    expect(merged).toMatchObject({ name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", home: "Tỉnh giả", addr: "Đường mẫu", phone: "0839395292" });
    expect(parseIdText("Nhãn lỗi: xxxxxxxxx\nGhi chú: dữ liệu giả").name).toBeNull();
  });
});
