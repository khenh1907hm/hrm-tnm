import { describe, expect, it } from "vitest";
import { createHrApp } from "../../app-core/createHrApp";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createMemoryRepositories } from "../../repositories/memory/createMemoryRepositories";
import type { Certificate } from "../certificates/types";
import { createCertificateType } from "./rules";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeInput } from "./types";

const input = (name: string): CertificateTypeInput => ({ name, requiredForPositions: [] });

describe("certificate type acceptance checks", () => {
  it("CTYPE_02 rejects the six exact duplicate, whitespace, archived, valid, short, and long name cases", () => {
    const electrical = SYSTEM_CERTIFICATE_TYPES.find((type) => type.key === "elec");
    if (!electrical) throw new Error("missing electrical system type");
    expect(createCertificateType(input("an toan dien"), [electrical], "duplicate-accent").ok).toBe(false);
    expect(createCertificateType(input("  An   toàn  điện "), [electrical], "duplicate-spaces").ok).toBe(false);
    expect(createCertificateType(input("Cẩu tháp"), [{ ...electrical, key: "custom-hidden-crane", name: "Cẩu tháp", archived: true }], "hidden-duplicate").ok).toBe(false);
    expect(createCertificateType(input("Cẩu tháp"), SYSTEM_CERTIFICATE_TYPES, "valid-crane").ok).toBe(true);
    expect(createCertificateType(input("A"), SYSTEM_CERTIFICATE_TYPES, "too-short").ok).toBe(false);
    expect(createCertificateType(input("X".repeat(101)), SYSTEM_CERTIFICATE_TYPES, "too-long").ok).toBe(false);
  });

  it("CTYPE_01 CTYPE_06 checks all seven system names, English names, order, and all 35 role requirements", () => {
    expect(SYSTEM_CERTIFICATE_TYPES.map(({ name, englishName, sortOrder }) => ({ name, englishName, sortOrder }))).toEqual([
      { name: "An toàn lao động", englishName: "Occupational safety", sortOrder: 1 },
      { name: "Khám sức khỏe", englishName: "Health examination", sortOrder: 2 },
      { name: "Bảo hiểm tai nạn lao động", englishName: "Occupational accident insurance", sortOrder: 3 },
      { name: "An toàn điện", englishName: "Electrical safety", sortOrder: 4 },
      { name: "Chứng chỉ hàn", englishName: "Welding certificate", sortOrder: 5 },
      { name: "Vận hành cần cẩu", englishName: "Crane operation", sortOrder: 6 },
      { name: "Vận hành xe nâng hàng", englishName: "Forklift operation", sortOrder: 7 },
    ]);
    const positions = ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
    expect(SYSTEM_CERTIFICATE_TYPES.map((type) => positions.map((position) => type.requiredForPositions.includes(position)))).toEqual([
      [true, true, true, true, true],
      [true, true, true, true, true],
      [false, false, true, true, true],
      [false, false, true, true, true],
      [false, false, false, false, false],
      [false, false, false, false, false],
      [false, false, false, false, false],
    ]);
  });

  it("CTYPE_04 refuses system archives, blocks custom types in use, requires a reason, and reserves hidden names", async () => {
    const repositories = createMemoryRepositories();
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("ctype-audit"), repositories });
    const systemList = await app.certificateTypes.list({ id: "admin", role: "admin" }, true);
    if (!systemList.ok) throw new Error("could not list certificate types");
    const system = systemList.value[0];
    if (!system) throw new Error("missing system category");
    const systemArchive = await app.certificateTypes.archive({ id: "admin", role: "admin" }, { id: system.id, expectedVersion: system.version, reason: "Không sử dụng" });
    expect(systemArchive.ok).toBe(false);

    const created = await app.certificateTypes.create({ id: "admin", role: "admin" }, input("Cẩu tháp"));
    if (!created.ok) throw new Error("could not create custom category");
    const archiveWithoutReason = await app.certificateTypes.archive({ id: "admin", role: "admin" }, { id: created.value.id, expectedVersion: created.value.version, reason: "  " });
    expect(archiveWithoutReason.ok).toBe(false);
    if (!archiveWithoutReason.ok) expect(archiveWithoutReason.errors[0]?.code).toBe("CTYPE_ARCHIVE_REASON");

    const currentCertificate: Certificate = {
      id: "cert-ctype-1", employeeId: "employee-ctype-1", type: created.value.key as Certificate["type"], title: "", number: "CRANE-001", expiryDate: "2027-01-01", issueDate: null,
      document: { id: "file-ctype-1", name: "scan.pdf", mime: "application/pdf", size: 12 }, supplementaryFiles: [],
      state: "current", version: 1, replacedBy: null, archiveReason: null,
    };
    await repositories.certificates.insert(currentCertificate);
    const archiveInUse = await app.certificateTypes.archive({ id: "admin", role: "admin" }, { id: created.value.id, expectedVersion: created.value.version, reason: "Ngừng sử dụng" });
    expect(archiveInUse.ok).toBe(false);
    if (!archiveInUse.ok) expect(archiveInUse.errors[0]?.code).toBe("CTYPE_HAS_CURRENT_CERTIFICATES");

    const hidden = { ...created.value, archived: true, archiveReason: "Ngừng sử dụng", version: created.value.version + 1 };
    expect(createCertificateType(input("cau thap"), [hidden], "same-name").ok).toBe(false);
  });

  it("CTYPE_05 RBAC_02 RBAC_03 checks each role against the create, update, and archive matrix and audits Admin changes", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("ctype-rbac") });
    const createdByAdmin = await app.certificateTypes.create({ id: "admin", role: "admin" }, input("Sơ cứu nâng cao"));
    if (!createdByAdmin.ok) throw new Error("could not create fixture category");
    const hr = ({ id: "outsider", role: "pending" } as never);
    expect(await app.certificateTypes.create(({ id: "outsider", role: "pending" } as never), input("Cẩu tháp phụ"))).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    expect(await app.certificateTypes.update(hr, { id: createdByAdmin.value.id, expectedVersion: 1, name: "Sơ cứu 2", requiredForPositions: [], sortOrder: 9 })).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });
    expect(await app.certificateTypes.archive(hr, { id: createdByAdmin.value.id, expectedVersion: 1, reason: "Ngừng dùng" })).toMatchObject({ ok: false, errors: [{ code: "FORBIDDEN" }] });

    const updated = await app.certificateTypes.update({ id: "admin", role: "admin" }, { id: createdByAdmin.value.id, expectedVersion: 1, name: "Sơ cứu nâng cao 2", requiredForPositions: [], sortOrder: 9 });
    if (!updated.ok) throw new Error("could not update fixture category");
    const archived = await app.certificateTypes.archive({ id: "admin", role: "admin" }, { id: updated.value.id, expectedVersion: updated.value.version, reason: "Ngừng sử dụng" });
    expect(archived.ok).toBe(true);
    const audit = await app.audit.list({ id: "admin", role: "admin" });
    expect(audit.ok && audit.value.filter((event) => event.entityType === "certificateType").map((event) => event.action)).toEqual([
      "certificateType.create", "certificateType.update", "certificateType.archive",
    ]);
  });
});
