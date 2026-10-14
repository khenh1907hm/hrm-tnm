import { describe, expect, it } from "vitest";
import * as certificateRules from "./rules";
import * as workerProfile from "../exports/workerProfile";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createHrApp } from "../../app-core/createHrApp";
import { createDemoRepositories } from "../../repositories/memory/seedDemo";
import { buildWorkerProfileData } from "../exports/workerProfile";
import type { Certificate } from "./types";
import type { Result } from "../../lib/result";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeRecord } from "../certificate-types/types";
import type { Signature } from "../signatures/types";

const admin = { id: "admin", role: "admin" as const };
const pdf = { id: "primary", name: "certificate.pdf", mime: "application/pdf", size: 1024 };
const supplement = (id: string, label = "Giấy chứng minh hoàn thành khóa học") => ({ file: { id, name: `${id}.pdf`, mime: "application/pdf", size: 128 }, label });
const draft = (employeeId: string, type: string, number: string, title = "", extra: Record<string, unknown> = {}) => ({
  employeeId, type: type as Certificate["type"], title, number, issueDate: "2026-01-01", expiryDate: "2027-01-01", document: pdf,
  supplementaryFiles: [], ...extra,
});
function expectOk<T>(result: Result<T>): asserts result is Extract<Result<T>, { ok: true }> {
  expect(result.ok).toBe(true);
}
function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}
async function setup() {
  const clock = fixedClock("2026-10-12T09:00:00+07:00");
  const repositories = await createDemoRepositories(clock, sequentialIds("seed-stage3"));
  const app = createHrApp({ clock, ids: sequentialIds("stage3"), repositories });
  const employees = await app.employees.list(admin);
  if (!employees.ok || !employees.value.items[11]) throw new Error("missing employee fixture");
  return { app, repositories, employee: employees.value.items[11] };
}

describe("certificate, export, and invariant acceptance", () => {
  it("CERT_01 accepts a certificate category registered by Admin", async () => {
    const { app, employee } = await setup();
    const category = await app.certificateTypes.create(admin, { name: "Cẩu tháp", requiredForPositions: [] });
    if (!category.ok) throw new Error("could not create custom category");
    const created = await app.certificates.add(admin, draft(employee.id, category.value.key, "CRANE-001"));
    expect(created.ok).toBe(true);
  });

  it("CERT_02 requires common certificate fields and permits labeled supplementary files", async () => {
    const { app, employee } = await setup();
    const created = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-002", "Taikisha", { supplementaryFiles: [supplement("supp-1")] }));
    expect(created.ok).toBe(true);
    const missing = await app.certificates.add(admin, { ...draft(employee.id, "atld", "SAFE-003"), document: null });
    expect(missing.ok).toBe(false);
    const invalidTitle = await app.certificates.add(admin, draft(employee.id, "health", "SAFE-003B", "X"));
    expect(invalidTitle.ok).toBe(false);
  });

  it("CERT_05 validates each supplementary attachment with the same type and size limits", async () => {
    const { app, employee } = await setup();
    const badSupplement = supplement("bad");
    const invalid = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-004", "Taikisha", { supplementaryFiles: [{ ...badSupplement, file: { ...badSupplement.file, mime: "text/plain" } }] }));
    expect(invalid.ok).toBe(false);
    const tooMany = await app.certificates.add(admin, draft(employee.id, "health", "SAFE-004B", "Long training", { supplementaryFiles: Array.from({ length: 11 }, (_, index) => supplement(`many-${index}`)) }));
    expect(tooMany.ok).toBe(false);
    const longLabel = await app.certificates.add(admin, draft(employee.id, "health", "SAFE-004C", "Taikisha", { supplementaryFiles: [supplement("long-label", "x".repeat(101))] }));
    expect(longLabel.ok).toBe(false);
    expect(certificateRules.validateCertificateAttachments(null, [])).toMatchObject([{ code: "CERT_FILE_REQUIRED" }]);
    expect(certificateRules.validateCertificateAttachments(pdf, [{ file: pdf, label: "x".repeat(101) }])).toMatchObject([{ code: "CERT_SUPPLEMENT_LABEL_INVALID" }]);
    expect(certificateRules.validateCertificateAttachments({ ...pdf, mime: "text/plain" }, [])).toMatchObject([{ code: "CERT_FILE_INVALID" }]);
    expect(certificateRules.validateCertificateAttachments(pdf, [{ file: pdf, label: null }])).toEqual([]);
    expect(certificateRules.validateCertificate({ type: "atld", number: "SAFE-005", issueDate: null, expiryDate: "2027-01-01", document: pdf }, "2026-10-12", "1988-05-12").errors).toEqual([]);
    expect(certificateRules.validateCertificate({ type: "unknown", number: "SAFE-006", issueDate: null, expiryDate: "2027-01-01", document: pdf, supplementaryFiles: [] }, "2026-10-12", "1988-05-12", []).errors.map((item) => item.code)).toContain("CERT_TYPE_INVALID");
    expect(certificateRules.validateCertificate({ type: "atld", number: "SAFE-007", issueDate: null, expiryDate: "2027-01-01", document: pdf, supplementaryFiles: Array.from({ length: 11 }, (_, index) => ({ file: pdf, label: `Attachment ${index}` })) }, "2026-10-12", "1988-05-12").errors.map((item) => item.code)).toContain("CERT_SUPPLEMENT_COUNT_INVALID");
  });

  it("CERT_06 INV_01 allows different titles but rejects normalized duplicate titles", async () => {
    const { app, employee } = await setup();
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-012", "Taikisha"))).ok).toBe(true);
    const duplicate = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-013", "  TAIKISHA "));
    expect(duplicate).toMatchObject({ ok: false, errors: [{ code: "CERT_ALREADY_EXISTS", field: "title" }] });
    expect(await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-014", "taikisha"))).toMatchObject({ ok: false, errors: [{ code: "CERT_ALREADY_EXISTS", field: "title" }] });
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-015", "Hòa Phát"))).ok).toBe(true);
    expect(await app.certificates.add(admin, draft(employee.id, "health", "SAFE-016", "A"))).toMatchObject({ ok: false, errors: [{ code: "CERT_TITLE_INVALID", field: "title" }] });
    expect(await app.certificates.add(admin, draft(employee.id, "health", "SAFE-017", "X".repeat(61)))).toMatchObject({ ok: false, errors: [{ code: "CERT_TITLE_INVALID", field: "title" }] });
    expect(await app.certificates.add(admin, draft(employee.id, "health", "SAFE-018", "<b>HTML</b>"))).toMatchObject({ ok: false, errors: [{ code: "CERT_TITLE_INVALID", field: "title" }] });
    expect((await app.certificates.add(admin, draft(employee.id, "health", "SAFE-019", "Công trình A (2026)"))).ok).toBe(true);
    expect((await app.certificates.add(admin, draft(employee.id, "health", "SAFE-020", "AB"))).ok).toBe(true);
    expect((await app.certificates.add(admin, draft(employee.id, "health", "SAFE-021", "X".repeat(60)))).ok).toBe(true);
  });

  it("CERT_06 rejects another unnamed certificate after an unnamed one and Taikisha", async () => {
    const { app, employee } = await setup();
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-010"))).ok).toBe(true);
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-011", "Taikisha"))).ok).toBe(true);
    expect(await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-011A"))).toMatchObject({ ok: false, errors: [{ code: "CERT_ALREADY_EXISTS", field: "title" }] });
  });

  it("CERT_06 rejects two current unnamed certificates of the same type with the exact conflict", async () => {
    const { app, employee } = await setup();
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-010"))).ok).toBe(true);
    expect(await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-010A"))).toMatchObject({ ok: false, errors: [{ code: "CERT_ALREADY_EXISTS", field: "title" }] });
  });

  it("CERT_06 permits an unnamed certificate to be added again after the unnamed one is archived", async () => {
    const { app, employee } = await setup();
    const unnamedOnly = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-021"));
    expect(unnamedOnly.ok).toBe(true);
    if (!unnamedOnly.ok) throw new Error("could not add unnamed certificate");
    const archivedUnnamed = await app.certificates.archive(admin, { id: unnamedOnly.value.id, expectedVersion: 1, reason: "Lưu bản không tên" });
    expect(archivedUnnamed.ok).toBe(true);
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-022"))).ok).toBe(true);
  });

  it("CERT_07 renews only the same normalized title and retains that title", async () => {
    const { app, employee } = await setup();
    const created = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-020", "Taikisha"));
    if (!created.ok) throw new Error("could not add initial certificate");
    const changedTitle = await app.certificates.renew(admin, { ...draft(employee.id, "atld", "SAFE-021", "Other"), id: created.value.id, expectedVersion: 1, expiryDate: "2028-01-01" });
    expect(changedTitle).toMatchObject({ ok: false, errors: [{ code: "CERT_RENEW_TITLE_INVALID", field: "title" }] });
    const renewed = await app.certificates.renew(admin, { ...draft(employee.id, "atld", "SAFE-021", "TAIKISHA"), id: created.value.id, expectedVersion: 1, expiryDate: "2028-01-01" });
    expect(renewed.ok && renewed.value.title).toBe("Taikisha");
  });

  it("CERT_09 rejects a repeated number for the same employee and type even with another title", async () => {
    const { app, employee } = await setup();
    expect((await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-030", "Alpha"))).ok).toBe(true);
    const duplicateNumber = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-030", "Beta"));
    expect(duplicateNumber).toMatchObject({ ok: false, errors: [{ code: "CERT_DUPLICATE_NUMBER", field: "number" }] });
  });

  it("CERT_10 cannot restore an archived certificate while its type and title pair is current", async () => {
    const { app, employee } = await setup();
    const archived = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-040", "Alpha"));
    const current = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-041", "Beta"));
    if (!archived.ok || !current.ok) throw new Error("could not create title-separated certificates");
    const hidden = await app.certificates.archive(admin, { id: archived.value.id, expectedVersion: 1, reason: "Lưu hồ sơ" });
    if (!hidden.ok) throw new Error("could not archive certificate");
    await app.certificates.archive(admin, { id: current.value.id, expectedVersion: 1, reason: "Lưu hồ sơ" });
    const replacement = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-042", "Alpha"));
    if (!replacement.ok) throw new Error("could not add a current Alpha certificate");
    expect(await app.certificates.restore(admin, { id: hidden.value.id, expectedVersion: hidden.value.version })).toMatchObject({ ok: false, errors: [{ code: "CERT_RESTORE_CONFLICT" }] });
  });

  it("CERT_11 manages supplementary files and replaces a required primary file", async () => {
    const { app, employee } = await setup();
    const created = await app.certificates.add(admin, draft(employee.id, "atld", "SAFE-050", "Taikisha"));
    if (!created.ok) throw new Error("could not add certificate");
    const changed = await app.certificates.updateAttachments(admin, {
      id: created.value.id, expectedVersion: 1, document: { ...pdf, id: "replacement" }, supplementaryFiles: [supplement("supp-2")],
    });
    expect(changed.ok && changed.value.document.id).toBe("replacement");
    expect(changed.ok && changed.value.supplementaryFiles.map((item) => item.file.id)).toEqual(["supp-2"]);
    const keptPrimary = await app.certificates.updateAttachments(admin, { id: created.value.id, expectedVersion: 2, supplementaryFiles: [] });
    expect(keptPrimary.ok && keptPrimary.value.document.id).toBe("replacement");
    const tooMany = await app.certificates.updateAttachments(admin, {
      id: created.value.id, expectedVersion: 3, supplementaryFiles: Array.from({ length: 11 }, (_, index) => supplement(`extra-${index}`)),
    });
    expect(tooMany.ok).toBe(false);
    const hr = await app.certificates.updateAttachments({ id: "hr", role: "hr" }, { id: created.value.id, expectedVersion: 3, supplementaryFiles: [] });
    expect(hr).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    const audit = await app.audit.list(admin);
    expect(audit.ok && audit.value.filter((event) => event.entityType === "certificate").map((event) => event.action)).toContain("certificate.attachments.update");
  });

  it("CERT_12 builds the Vietnamese type name and optional title consistently", () => {
    const formatter = Reflect.get(certificateRules, "certificateDisplayName");
    expect(typeof formatter).toBe("function");
    if (typeof formatter === "function") {
      expect(formatter("atld", "Taikisha")).toBe("An toàn lao động (Taikisha)");
      expect(formatter("atld", "")).toBe("An toàn lao động");
      expect(certificateRules.displayCertificateTitle(undefined)).toBe("");
      expect(formatter({ name: "Cẩu tháp" }, "  Hạng   A ")).toBe("Cẩu tháp (Hạng A)");
      expect(formatter("custom-unregistered", "")).toBe("custom-unregistered");
    }
  });

  it("EXP_02 ticks a system type if any title remains valid on the signing date", () => {
    const employee = { id: "exp-employee", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", home: "Tỉnh mẫu", address: "Địa chỉ", phone: "0839395292", startDate: "2020-01-15", position: "Nhân viên hiện trường", group: 1 } as Parameters<typeof buildWorkerProfileData>[0];
    const signer = { id: "sig", name: "Nguyễn Minh An", role: "Giám đốc", isDefault: true, version: 1, file: { ...pdf, hasTransparency: true } } as Parameters<typeof buildWorkerProfileData>[2];
    const certificate = (id: string, title: string, expiryDate: string) => ({ id, employeeId: employee.id, type: "atld" as Certificate["type"], title, number: id, expiryDate, issueDate: null, document: pdf, supplementaryFiles: [], state: "current" as const, version: 1, replacedBy: null, archiveReason: null } as Certificate);
    const output = buildWorkerProfileData(employee, [certificate("expired", "", "2026-10-15"), certificate("valid", "Taikisha", "2027-03-01")], signer, "2026-10-20");
    expect(output.certificates.find((item) => item.type === "atld")?.ticked).toBe(true);
    expect(output.certificates.find((item) => item.type === "atld")?.note).toBeNull();
    expect(output.scans.map((file) => file.id)).toEqual(["primary"]);
  });

  it("EXP_07 keeps custom categories off the seven system checklist and scans them only when selected", async () => {
    const { app, employee } = await setup();
    const category = await app.certificateTypes.create(admin, { name: "Cẩu tháp", requiredForPositions: [] });
    expectOk(category);
    const created = await app.certificates.add(admin, draft(employee.id, category.value.key, "CRANE-EXP-001", "Chứng chỉ cần cẩu"));
    expectOk(created);
    const signer: Signature = { id: "sig-exp-07", name: "Nguyễn Minh An", role: "Giám đốc", isDefault: true, version: 1, file: { ...pdf, mime: "image/png", hasTransparency: true } };
    const types = await app.certificateTypes.list(admin);
    expectOk(types);
    const archivedSystem = types.value.find((type) => type.key === "atld");
    expectDefined(archivedSystem);
    const archivedCopy: CertificateTypeRecord = { ...archivedSystem, id: "archived-atld", key: "atld-archived", archived: true };
    const nonSystemCopy: CertificateTypeRecord = { ...archivedSystem, id: "non-system-atld", key: "non-system-atld", system: false };
    const tieA: CertificateTypeRecord = { ...archivedSystem, id: "tie-a", key: "tie-a", sortOrder: 99, name: "Zeta" };
    const tieB: CertificateTypeRecord = { ...archivedSystem, id: "tie-b", key: "tie-b", sortOrder: 99, name: "Alpha" };
    const profileTypes: CertificateTypeRecord[] = [...types.value, archivedCopy, nonSystemCopy, tieA, tieB];
    const defaultOutput = buildWorkerProfileData(employee, [created.value], signer, "2026-10-20", types.value);
    expect(defaultOutput.certificates).toHaveLength(7);
    expect(defaultOutput.certificates.some((row) => row.type === category.value.key)).toBe(false);
    expect(defaultOutput.scans).toHaveLength(0);
    const selectedOutput = buildWorkerProfileData(employee, [created.value], signer, "2026-10-20", types.value, { extraCertificateIds: [created.value.id] });
    expect(selectedOutput.certificates).toHaveLength(7);
    expect(selectedOutput.scans.map((file) => file.id)).toEqual([pdf.id]);
    expect(buildWorkerProfileData(employee, [created.value], signer, "2026-10-20", []).certificates).toEqual([]);
    const tieOutput = buildWorkerProfileData(employee, [created.value], signer, "2026-10-20", profileTypes);
    expect(tieOutput.certificates.map((row) => row.displayName).slice(-2)).toEqual(["Alpha", "Zeta"]);
  });

  it("INV_08 preserves unique normalized category names including hidden categories", async () => {
    const { app } = await setup();
    const created = await app.certificateTypes.create(admin, { name: "Cẩu tháp", requiredForPositions: [] });
    expectOk(created);
    const initialList = await app.certificateTypes.list(admin, true);
    expectOk(initialList);
    const initialCount = initialList.value.length;
    for (const duplicateName of ["cau thap", "  CAU   THAP "]) {
      const duplicate = await app.certificateTypes.create(admin, { name: duplicateName, requiredForPositions: [] });
      expect(duplicate).toMatchObject({ ok: false, errors: [{ code: "CTYPE_NAME_DUPLICATE", field: "name" }] });
      const afterFailure = await app.certificateTypes.list(admin, true);
      expectOk(afterFailure);
      expect(afterFailure.value).toHaveLength(initialCount);
    }
    const archived = await app.certificateTypes.archive(admin, { id: created.value.id, expectedVersion: created.value.version, reason: "Ngừng sử dụng" });
    expectOk(archived);
    const afterArchive = await app.certificateTypes.list(admin, true);
    expectOk(afterArchive);
    const beforeHiddenDuplicate = afterArchive.value.length;
    const hiddenDuplicate = await app.certificateTypes.create(admin, { name: "CẨU THÁP", requiredForPositions: [] });
    expect(hiddenDuplicate).toMatchObject({ ok: false, errors: [{ code: "CTYPE_NAME_DUPLICATE", field: "name" }] });
    const afterHiddenFailure = await app.certificateTypes.list(admin, true);
    expectOk(afterHiddenFailure);
    expect(afterHiddenFailure.value).toHaveLength(beforeHiddenDuplicate);
  });

  it("EXP_05 selects the latest valid title by default and honors explicit selection and supplementary option", () => {
    const build = Reflect.get(workerProfile, "buildCertificateScanSelection");
    expect(typeof build).toBe("function");
    if (typeof build === "function") {
      const attachment = supplement("extra-1");
      const certs: Certificate[] = [
        { id: "early", employeeId: "scan-employee", type: "atld", title: "", number: "SAFE-001", issueDate: null, expiryDate: "2027-01-01", document: pdf, supplementaryFiles: [attachment], state: "current", version: 1, replacedBy: null, archiveReason: null },
        { id: "late", employeeId: "scan-employee", type: "atld", title: "Zeta", number: "SAFE-002", issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: "late-doc" }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null },
        { id: "tie", employeeId: "scan-employee", type: "atld", title: "Alpha", number: "SAFE-003", issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: "tie-doc" }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null },
      ];
      expect(build(certs, ["atld"], "2026-10-20").map((item: { id: string }) => item.id)).toEqual(["tie-doc"]);
      expect(build(certs, ["atld"], "2026-10-20", { selectedCertificateIds: ["early"] }).map((item: { id: string }) => item.id)).toEqual(["primary"]);
      expect(build(certs, ["atld"], "2026-10-20", { selectedCertificateIds: ["early"], includeSupplementary: true }).map((item: { id: string }) => item.id)).toEqual(["primary", "extra-1"]);
    }
  });

  it("EXP_08 breaks same-expiry ties by normalized title and then id in code-point order", () => {
    const build = workerProfile.buildCertificateScanSelection;
    const tied: Certificate[] = [
      { id: "cert-z", employeeId: "scan-employee", type: "atld", title: "Đặng", number: "TIE-003", issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: "file-z" }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null },
      { id: "a-cert", employeeId: "scan-employee", type: "atld", title: "ban", number: "TIE-002", issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: "file-b" }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null },
      { id: "A-cert", employeeId: "scan-employee", type: "atld", title: "Bán", number: "TIE-001", issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: "file-a" }, supplementaryFiles: [], state: "current", version: 1, replacedBy: null, archiveReason: null },
    ];
    expect(build(tied, ["atld"], "2027-01-01").map((file) => file.id)).toEqual(["file-a"]);
  });

  it("EXP_08 sorts tied worker-profile categories by normalized Vietnamese name then id", async () => {
    const { employee } = await setup();
    const tiedTypes: CertificateTypeRecord[] = [
      { ...SYSTEM_CERTIFICATE_TYPES[0]!, id: "z-type", key: "z-type", name: "Đào tạo", sortOrder: 1 },
      { ...SYSTEM_CERTIFICATE_TYPES[1]!, id: "z-an", key: "z-an", name: "An toàn", sortOrder: 1 },
      { ...SYSTEM_CERTIFICATE_TYPES[2]!, id: "a-an", key: "a-an", name: "An toan", sortOrder: 1 },
    ];
    const signature: Signature = { id: "signer", name: "Nguyễn Văn A", role: "Giám đốc", file: { ...pdf, hasTransparency: false }, isDefault: true, version: 1 };
    const output = buildWorkerProfileData(employee, [], signature, "2026-10-12", tiedTypes);
    expect(output.certificates.map((row) => row.type)).toEqual(["a-an", "z-an", "z-type"]);
  });

  it("SRCH_03 filters employees missing a required certificate", async () => {
    const { app, repositories, employee } = await setup();
    const categoryList = await app.certificateTypes.list(admin);
    if (!categoryList.ok) throw new Error("could not list certificate categories");
    const required = categoryList.value.filter((type) => type.requiredForPositions.includes(employee.position));
    for (const [index, type] of required.entries()) {
      await repositories.certificates.insert({
        id: `complete-${type.key}`, employeeId: employee.id, type: type.key, title: "", number: `COMP-${String(index + 1).padStart(3, "0")}`,
        issueDate: null, expiryDate: "2028-01-01", document: { ...pdf, id: `complete-file-${index}` }, supplementaryFiles: [],
        state: "current", version: 1, replacedBy: null, archiveReason: null,
      });
    }
    const result = await app.employees.search(admin, { missingRequiredCertificate: true } as Parameters<typeof app.employees.search>[1]);
    expect(result.ok && result.value.items.length).toBeGreaterThan(0);
    expect(result.ok && result.value.items).not.toContainEqual(expect.objectContaining({ id: employee.id }));
  });
});
