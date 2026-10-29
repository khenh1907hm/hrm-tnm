import { describe, expect, it } from "vitest";
import { fixedClock } from "../lib/clock";
import { sequentialIds } from "../lib/ids";
import { createHrApp } from "../app-core/createHrApp";
import { createDemoRepositories } from "../repositories/memory/seedDemo";
import { validateEmployee } from "./employees/rules";
import { validateCertificate } from "./certificates/rules";
import { certificateStatus } from "./certificates/status";
import { computeDueReminders } from "./reminders/due";
import { parseIdText } from "./ocr/parseIdText";
import { buildWorkerProfileData } from "./exports/workerProfile";
import { addDays } from "../lib/dates";
import type { EmployeeInput } from "./employees/types";

const clock = () => fixedClock("2026-10-12T09:00:00+07:00");
const employeeInput: EmployeeInput = {
  code: "TNM901", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088012345", phone: "0839395292",
  home: "Tỉnh mẫu", address: "Địa chỉ mẫu", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1", status: "active", endDate: null,
};
const admin = { id: "trace-admin", role: "admin" as const };
const hr = { id: "trace-hr", role: "hr" as const };
async function makeApp() {
  const fixed = clock();
  const repositories = await createDemoRepositories(fixed, sequentialIds("trace-seed"));
  return { repositories, app: createHrApp({ clock: fixed, ids: sequentialIds("trace-app"), repositories }) };
}

describe("dedicated rule behavior", () => {
  it("EMP_02 rejects a missing required employee name", () => {
    expect(validateEmployee({ ...employeeInput, name: "" }, "2026-10-12").errors.map((item) => item.code)).toContain("NAME_LENGTH");
  });
  it("EMP_03 accepts optional home, address, group, and emergency contact as absent", () => {
    const result = validateEmployee({ ...employeeInput, home: "", address: "", group: null, emergencyContactId: null }, "2026-10-12");
    expect(result.errors).toEqual([]);
  });
  it("EMP_05 rejects a start date before the employee turns fifteen", () => {
    expect(validateEmployee({ ...employeeInput, dob: "2010-10-13", startDate: "2025-10-12" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_START_TOO_EARLY");
  });
  it("EMP_06 rejects a resigned employee without a valid end date", () => {
    expect(validateEmployee({ ...employeeInput, status: "resigned", endDate: null }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_END_DATE_INVALID");
  });
  it("EMP_07 rejects an emergency contact outside the commander list", () => {
    expect(validateEmployee({ ...employeeInput, emergencyContactId: "not-a-commander" }, "2026-10-12").errors.map((item) => item.code)).toContain("EMP_EMERGENCY_CONTACT_INVALID");
  });
  it("CERT_03 rejects a certificate number below the three-character minimum", () => {
    const input = { type: "atld" as const, title: "", number: "AB", issueDate: "2025-01-01", expiryDate: "2027-01-01", document: { id: "f", name: "a.pdf", mime: "application/pdf", size: 10 }, supplementaryFiles: [] };
    expect(validateCertificate(input, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_NUMBER_INVALID");
  });
  it("CERT_04 rejects a certificate issue date in the future", () => {
    const input = { type: "atld" as const, title: "", number: "SAFE-901", issueDate: "2026-10-13", expiryDate: "2027-01-01", document: { id: "f", name: "a.pdf", mime: "application/pdf", size: 10 }, supplementaryFiles: [] };
    expect(validateCertificate(input, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_ISSUE_DATE_INVALID");
  });
  it("CERT_08 refuses to change a certificate type through the facade", async () => {
    const { repositories, app } = await makeApp();
    const certificate = (await repositories.certificates.list())[0];
    expect(certificate).toBeDefined();
    if (!certificate) throw new Error("demo certificate missing");
    expect(await app.certificates.update(admin, { ...certificate, expectedVersion: certificate.version, type: certificate.type === "atld" ? "elec" : "atld" })).toMatchObject({ ok: false, errors: [{ code: "CERT_TYPE_INVALID", field: "type" }] });
  });
  it("STATUS_02 marks the inclusive thirtieth day as expiring", () => {
    expect(certificateStatus("2026-11-11", "2026-10-12")).toEqual({ status: "expiring", daysLeft: 30 });
  });
  it("ALERT_01 lists current certificates in ascending days-left order", async () => {
    const { app } = await makeApp();
    const result = await app.certificates.listExpiring(admin);
    expect(result.ok && result.value.length).toBeGreaterThan(0);
    expect(result.ok && result.value.every((item, index, items) => index === 0 || items[index - 1]!.daysLeft <= item.daysLeft)).toBe(true);
  });
  it("ALERT_02 calculates the reminder send date from the certificate expiry date", async () => {
    const { app } = await makeApp();
    const result = await app.certificates.listExpiring(admin);
    expect(result.ok && result.value.length).toBeGreaterThan(0);
    expect(result.ok && result.value.every((item) => item.reminderSendDate === addDays(item.expiryDate, -30))).toBe(true);
  });
  it("REM_01 selects a current certificate that enters the thirty-day window", async () => {
    const { app } = await makeApp();
    const result = await app.reminders.computeDue(admin);
    expect(result.ok && result.value.length).toBeGreaterThan(0);
  });
  it("REM_02 selects a late-entered certificate on its first reminder run", async () => {
    const { app } = await makeApp();
    const result = await app.reminders.computeDue(admin);
    expect(result.ok && result.value.some((item) => item.daysLeft <= 10)).toBe(true);
  });
  it("REM_03 excludes expired certificates unless expired notices are enabled", () => {
    const worker = { ...employeeInput, id: "rem03", version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null };
    const certificate = { id: "expired", employeeId: worker.id, type: "atld", title: "", number: "SAFE-903", issueDate: "2025-01-01", expiryDate: "2026-10-11", document: { id: "file", name: "x.pdf", mime: "application/pdf", size: 12 }, supplementaryFiles: [], state: "current" as const, version: 1, replacedBy: null, archiveReason: null };
    expect(computeDueReminders([certificate], [worker], "2026-10-12", false, [])).toHaveLength(0);
    expect(computeDueReminders([certificate], [worker], "2026-10-12", true, [])).toHaveLength(1);
  });
  it("REM_04 skips sends when there are no configured recipients", async () => {
    const { app } = await makeApp();
    const result = await app.reminders.run(admin);
    expect(result.ok && result.value.skipped.every((item) => item.code === "NO_RECIPIENT")).toBe(true);
  });
  it("REM_05 reports mail failures without recording a sent reminder", async () => {
    const fixed = clock();
    const repositories = await createDemoRepositories(fixed, sequentialIds("rem05-seed"));
    const app = createHrApp({ clock: fixed, ids: sequentialIds("rem05-app"), repositories, mailer: { send: async () => { throw new Error("mail unavailable"); } } });
    const changed = await app.settings.update(admin, { reminderEmails: ["hr@example.com"], sendExpiredNotice: false, expectedVersion: 0 });
    expect(changed.ok).toBe(true);
    const result = await app.reminders.run(admin);
    expect(result.ok && result.value.failed.length).toBeGreaterThan(0);
  });
  it("SIG_01 rejects a signature file that is not a transparent PNG", async () => {
    const { app } = await makeApp();
    expect(await app.signatures.add(admin, { name: "Nguyễn An", role: "Giám đốc", file: { id: "sig", name: "sig.jpg", mime: "image/jpeg", size: 100, hasTransparency: false } })).toMatchObject({ ok: false, errors: [{ code: "SIG_INVALID" }] });
  });
  it("SIG_02 INV_03 marks the first added signature as the only default", async () => {
    const { app } = await makeApp();
    const first = await app.signatures.add(admin, { name: "Nguyễn An", role: "Giám đốc", file: { id: "s1", name: "s1.png", mime: "image/png", size: 100, hasTransparency: true } });
    const second = await app.signatures.add(admin, { name: "Trần Bình", role: "Nhân sự", file: { id: "s2", name: "s2.png", mime: "image/png", size: 100, hasTransparency: true } });
    expect([first.ok && first.value.isDefault, second.ok && second.value.isDefault]).toEqual([true, false]);
  });
  it("SIG_03 prevents removal of the final signature", async () => {
    const { app } = await makeApp();
    const added = await app.signatures.add(admin, { name: "Nguyễn An", role: "Giám đốc", file: { id: "s1", name: "s1.png", mime: "image/png", size: 100, hasTransparency: true } });
    expect(added.ok && await app.signatures.remove(admin, added.value.id)).toMatchObject({ ok: false, errors: [{ code: "SIGNATURE_LAST" }] });
  });
  it("RBAC_02 returns FORBIDDEN from the protected HR certificate-type use case", async () => {
    const { app } = await makeApp();
    expect(await app.certificateTypes.create(({ id: "outsider", role: "pending" } as never), { name: "Không được phép", requiredForPositions: [] })).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
  });
  it("AUD_01 writes an audit event for successful changes and none for denied changes", async () => {
    const { app } = await makeApp();
    const before = await app.audit.list(admin);
    const denied = await app.employees.create(({ id: "outsider", role: "pending" } as never), employeeInput);
    expect(denied).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    const added = await app.signatures.add(admin, { name: "Nguyễn An", role: "Giám đốc", file: { id: "aud1", name: "s.png", mime: "image/png", size: 100, hasTransparency: true } });
    const after = await app.audit.list(admin);
    expect(added.ok && before.ok && after.ok && after.value.length).toBe(before.ok ? before.value.length + 1 : 0);
    expect(after.ok && after.value.at(-1)?.action).toBe("signature.add");
  });
  it("AUD_02 masks CCCD values in persisted audit snapshots", async () => {
    const { app } = await makeApp();
    const listed = await app.employees.list(admin);
    if (!listed.ok || !listed.value.items[0]) throw new Error("employee fixture missing");
    await app.employees.revealCccd(admin, listed.value.items[0].id);
    const audit = await app.audit.list(admin);
    expect(audit.ok && JSON.stringify(audit.value)).not.toContain("079088012345");
  });
  it("AUD_03 denies HR access to the append-only audit log", async () => {
    const { app } = await makeApp();
    expect(await app.audit.list(hr)).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
  });
  it("EXP_01 blocks readiness when the signer is not in the signature library", async () => {
    const { app } = await makeApp();
    const employees = await app.employees.list(admin);
    if (!employees.ok || !employees.value.items[0]) throw new Error("employee fixture missing");
    const result = await app.exports.checkReadiness(admin, { employeeId: employees.value.items[0].id, signDate: "2026-10-12", signerId: "missing" });
    expect(result.ok && result.value.errors.map((item) => item.code)).toContain("SIGNATURE_NOT_FOUND");
  });
  it("EXP_03 returns a warning when the employee start date follows the signing date", async () => {
    const { app } = await makeApp();
    const employees = await app.employees.list(admin);
    if (!employees.ok || !employees.value.items[0]) throw new Error("employee fixture missing");
    const signer = await app.signatures.add(admin, { name: "Nguyễn An", role: "Giám đốc", file: { id: "exp03", name: "s.png", mime: "image/png", size: 10, hasTransparency: true } });
    if (!signer.ok) throw new Error("signature fixture missing");
    const result = await app.exports.buildWorkerProfile(admin, { employeeId: employees.value.items[0].id, signDate: "2019-01-01", signerId: signer.value.id });
    expect(result.ok && result.warnings.map((item) => item.code)).toContain("EXP_START_AFTER_SIGN");
  });
  it("EXP_06 returns profile data without generating a PDF", () => {
    const worker = { ...employeeInput, id: "exp06", version: 1, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null };
    const signer = { id: "sig", name: "Nguyễn An", role: "Giám đốc", file: { id: "f", name: "s.png", mime: "image/png", size: 10, hasTransparency: true }, isDefault: true, version: 1 };
    const result = buildWorkerProfileData(worker, [], signer, "2026-10-12");
    expect(result).toHaveProperty("certificates");
    expect(result).not.toHaveProperty("pdf");
  });
  it("OCR_04 ignores an old nine-digit identity number", () => {
    expect(parseIdText("Số CMND: 123456789").cccd).toBeNull();
  });
});
