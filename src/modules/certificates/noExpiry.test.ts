import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createHrApp } from "../../app-core/createHrApp";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { createCertificateType, updateCertificateType } from "../certificate-types/rules";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";
import type { Employee } from "../employees/types";
import { computeDueReminders } from "../reminders/due";
import { getCertificateChecklist } from "./checklist";
import { hasCertificateNumberConflict, validateCertificate } from "./rules";
import { expiryStatus, formatExpiry, isValidOn, profileCertificateStatus } from "./status";
import type { Certificate } from "./types";

const file = { id: "f", name: "bang.pdf", mime: "application/pdf", size: 100 };
const degree: CertificateTypeRecord = { id: "ctype-degree", key: "custom-ctype-degree", name: "Bằng cấp chuyên môn", englishName: null, requiredForPositions: ["Nhân viên hiện trường"], sortOrder: 9, system: false, archived: false, archiveReason: null, version: 1, noExpiry: true };
const types = [...SYSTEM_CERTIFICATE_TYPES, degree];
const employee: Employee = {
  id: "w1", code: "TNM015", name: "Đặng Minh Hải", dob: "1979-11-04", gender: "Nam", cccd: "082079000107", phone: "0909000111",
  home: "", address: "", position: "Nhân viên hiện trường", group: 3, startDate: "2001-12-14", emergencyContactId: null,
  status: "active", endDate: null, version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null,
};
const certificate = (extras: Partial<Certificate>): Certificate => ({
  id: "c1", employeeId: employee.id, type: degree.key, title: "", number: "C 968226", issueDate: "2001-12-14", expiryDate: null, document: file, supplementaryFiles: [],
  state: "current", version: 1, replacedBy: null, archiveReason: null, ...extras,
});

describe("loại chứng chỉ không có thời hạn", () => {
  it("CTYPE_07 tạo loại có cờ noExpiry; sửa mà không gửi cờ thì giữ nguyên, gửi thì đổi", () => {
    const created = createCertificateType({ name: "Bằng cấp chuyên môn", requiredForPositions: [], noExpiry: true }, SYSTEM_CERTIFICATE_TYPES, "ctype-degree");
    expect(created.ok && created.value.noExpiry).toBe(true);
    const plain = createCertificateType({ name: "Căn cước công dân", requiredForPositions: [] }, SYSTEM_CERTIFICATE_TYPES, "ctype-cccd");
    expect(plain.ok && plain.value.noExpiry).toBe(false);
    if (!created.ok) return;
    const kept = updateCertificateType(created.value, { name: "Bằng cấp", requiredForPositions: [] }, 9, [created.value]);
    expect(kept.ok && kept.value.noExpiry).toBe(true);
    const turnedOff = updateCertificateType(created.value, { name: "Bằng cấp", requiredForPositions: [], noExpiry: false }, 9, [created.value]);
    expect(turnedOff.ok && turnedOff.value.noExpiry).toBe(false);
  });

  it("CERT_02 chỉ loại không có thời hạn mới được để trống ngày hết hạn", () => {
    const input = { type: degree.key, title: "", number: "C 968226", issueDate: "2001-12-14", expiryDate: null, document: file, supplementaryFiles: [] };
    expect(validateCertificate(input, "2026-10-23", employee.dob, types).errors).toEqual([]);
    const required = validateCertificate({ ...input, type: "health" }, "2026-10-23", employee.dob, types);
    expect(required.errors.map((item) => item.code)).toEqual(["CERT_EXPIRY_REQUIRED"]);
    // Loại không hạn vẫn được nhập hạn nếu giấy có ghi; khi đó kiểm tra hạn như thường
    expect(validateCertificate({ ...input, expiryDate: "2000-01-01" }, "2026-10-23", employee.dob, types).errors.map((item) => item.code)).toContain("CERT_EXPIRY_BEFORE_ISSUE");
  });

  it("CERT_03 cho để trống số khi giấy không ghi số; có nhập thì phải đúng dạng, và số trống không bị coi là trùng", () => {
    const input = { type: "health", title: "", number: "", issueDate: "2026-02-25", expiryDate: "2027-02-25", document: file, supplementaryFiles: [] };
    expect(validateCertificate(input, "2026-10-23", employee.dob, types).errors).toEqual([]);
    expect(validateCertificate({ ...input, number: "   " }, "2026-10-23", employee.dob, types).errors).toEqual([]);
    expect(validateCertificate({ ...input, number: "AB" }, "2026-10-23", employee.dob, types).errors.map((item) => item.code)).toEqual(["CERT_NUMBER_INVALID"]);
    expect(hasCertificateNumberConflict(employee.id, "health", "", [certificate({ type: "health", number: "" })])).toBe(false);
  });

  it("CERT_13 chứng chỉ không có thời hạn luôn còn hiệu lực: trạng thái, danh sách bắt buộc, không nhắc hạn", () => {
    expect(isValidOn(null, "2099-01-01")).toBe(true);
    expect(isValidOn("2026-06-10", "2026-10-23")).toBe(false);
    expect(expiryStatus(null, "2026-10-23")).toEqual({ status: "valid", daysLeft: null });
    expect(profileCertificateStatus([null], "2026-10-23")).toBe("valid");
    expect(formatExpiry(null)).toBe("Không thời hạn");
    expect(formatExpiry("2039-11-04")).toBe("04/11/2039");
    const { rows } = getCertificateChecklist(employee, types, [certificate({})], "2026-10-23");
    expect(rows.find((row) => row.type === degree.key)).toMatchObject({ status: "valid", daysLeft: null, expiryDate: null });
    expect(computeDueReminders([certificate({})], [employee], "2026-10-23", true, [])).toEqual([]);
  });

  it("CERT_13 lưu, gia hạn và liệt kê sắp hết hạn qua app: chứng chỉ không hạn không vào danh sách nhắc", async () => {
    const clock = fixedClock("2026-10-23T09:00:00+07:00");
    const repositories = await createDemoRepositories(clock, sequentialIds("no-expiry-seed"));
    const app = createHrApp({ clock, ids: sequentialIds("no-expiry-app"), repositories });
    const admin = { id: "admin-1", role: "admin" as const };
    const type = await app.certificateTypes.create(admin, { name: "Bằng cấp chuyên môn", requiredForPositions: [], noExpiry: true });
    if (!type.ok) throw new Error(type.errors.map((item) => item.code).join());
    const listed = await app.employees.list(admin);
    const worker = listed.ok ? listed.value.items[0] : undefined;
    if (!worker) throw new Error("thiếu nhân sự mẫu");
    const added = await app.certificates.add(admin, { employeeId: worker.id, type: type.value.key, number: "", issueDate: "2001-12-14", expiryDate: null, document: file });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.expiryDate).toBeNull();
    const renewed = await app.certificates.renew(admin, { id: added.value.id, expectedVersion: added.value.version, type: type.value.key, number: "", issueDate: "2001-12-14", expiryDate: null, document: file });
    expect(renewed.ok).toBe(true);
    const expiring = await app.certificates.listExpiring(admin);
    expect(expiring.ok && expiring.value.some((row) => row.type === type.value.key)).toBe(false);
  });
});
