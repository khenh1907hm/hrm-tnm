import { describe, expect, it } from "vitest";
import { fixedClock } from "../../lib/clock";
import { sequentialIds } from "../../lib/ids";
import { createHrApp } from "../../app-core/createHrApp";
import { archiveCertificateType, createCertificateType, sortCertificateTypes, updateCertificateType, validateCertificateTypeInput } from "./rules";
import { certificateTypeInputSchema } from "./schema";
import { SYSTEM_CERTIFICATE_TYPES, type CertificateTypeInput } from "./types";

const allPositions = ["Giám đốc", "Nhân sự", "Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
const managerPositions = ["Trưởng phòng kỹ thuật", "Nhân viên kỹ thuật", "Nhân viên hiện trường"] as const;
const customInput = { name: "  Chứng chỉ sơ cứu ", englishName: "First Aid", requiredForPositions: ["Nhân viên hiện trường"] } satisfies CertificateTypeInput;

describe("certificate type rules", () => {
  it("CTYPE_01 exposes seven configurable system categories with stable internal keys", () => {
    expect(SYSTEM_CERTIFICATE_TYPES).toHaveLength(7);
    expect(SYSTEM_CERTIFICATE_TYPES.every((type) => type.system && !type.archived)).toBe(true);
    expect(SYSTEM_CERTIFICATE_TYPES.map((type) => type.key)).toEqual(["atld", "health", "ins", "elec", "weld", "crane", "fork"]);
  });

  it("CTYPE_02 validates required fields and unique normalized names including hidden rows", () => {
    const hidden = { ...SYSTEM_CERTIFICATE_TYPES[0]!, archived: true };
    const duplicate = createCertificateType({ name: "AN TOAN   LAO DONG", requiredForPositions: [] }, [hidden], "new-id");
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors.map((item) => item.code)).toContain("CTYPE_NAME_DUPLICATE");
    const created = createCertificateType(customInput, SYSTEM_CERTIFICATE_TYPES, "new-type");
    expect(created.ok && created.value.name).toBe("Chứng chỉ sơ cứu");
    expect(created.ok && created.value.sortOrder).toBe(8);
    expect(certificateTypeInputSchema.safeParse({ ...customInput, requiredForPositions: ["Thực tập"] }).success).toBe(false);
    expect(createCertificateType({ name: "x", englishName: "a".repeat(101), requiredForPositions: [] }, [], "bad").ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "x", requiredForPositions: [] }, []).ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "a".repeat(101), requiredForPositions: [] }, []).ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "Loại mới", englishName: "a".repeat(101), requiredForPositions: [] }, []).ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "Loại mới", requiredForPositions: ["Sai"] as never }, []).ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "Loại mới", requiredForPositions: null as never }, []).ok).toBe(false);
    expect(validateCertificateTypeInput({ name: "Tên đã có", requiredForPositions: [] }, [{ ...SYSTEM_CERTIFICATE_TYPES[0]!, name: "Tên đã có" }], SYSTEM_CERTIFICATE_TYPES[0]!.id).ok).toBe(true);
    expect(createCertificateType({ name: "Loại mới", requiredForPositions: [] }, [], "same").ok).toBe(true);
    expect(createCertificateType({ name: "Loại mới", requiredForPositions: [] }, [{ ...SYSTEM_CERTIFICATE_TYPES[0]!, id: "same" }], "same").ok).toBe(false);
    expect(createCertificateType({ name: "Loại mới", requiredForPositions: [] }, [{ ...SYSTEM_CERTIFICATE_TYPES[0]!, key: "custom-same" }], "same").ok).toBe(false);
  });

  it("CTYPE_03 applies one shared input contract to every certificate category", () => {
    const shape = Object.keys(certificateTypeInputSchema.shape).sort();
    expect(shape).toEqual(["englishName", "name", "noExpiry", "requiredForPositions"]);
    for (const type of SYSTEM_CERTIFICATE_TYPES) {
      expect(Object.keys(type).sort()).toEqual(["archiveReason", "archived", "englishName", "id", "key", "name", "requiredForPositions", "sortOrder", "system", "version"]);
    }
  });

  it("CTYPE_04 updates categories and only archives eligible custom categories with a reason", () => {
    const custom = createCertificateType(customInput, SYSTEM_CERTIFICATE_TYPES, "editable");
    if (!custom.ok) throw new Error("expected category creation to pass");
    const edited = updateCertificateType(custom.value, { ...customInput, name: "Sơ cứu nâng cao", requiredForPositions: [...managerPositions] }, 3, [...SYSTEM_CERTIFICATE_TYPES, custom.value]);
    expect(edited.ok && edited.value.name).toBe("Sơ cứu nâng cao");
    expect(archiveCertificateType(custom.value, "", false).ok).toBe(false);
    expect(archiveCertificateType(custom.value, "Đã ngừng", true).ok).toBe(false);
    expect(archiveCertificateType({ ...custom.value, archived: true }, "Đã ngừng", false).ok).toBe(false);
    expect(archiveCertificateType(SYSTEM_CERTIFICATE_TYPES[0]!, "Lý do hợp lệ", false).ok).toBe(false);
    expect(updateCertificateType(custom.value, customInput, 0, [custom.value]).ok).toBe(false);
    expect(updateCertificateType(custom.value, { ...customInput, name: "Tên trùng" }, 1, [{ ...SYSTEM_CERTIFICATE_TYPES[0]!, name: "Tên trùng" }, custom.value]).ok).toBe(false);
    const archived = archiveCertificateType(custom.value, "Ngừng sử dụng", false);
    expect(archived.ok && archived.value.archived).toBe(true);
  });

  it("CTYPE_05 sorts active categories and limits management to Admin with audit events", async () => {
    const app = createHrApp({ clock: fixedClock("2026-10-12T09:00:00+07:00"), ids: sequentialIds("ctype") });
    const listed = await app.certificateTypes.list({ id: "hr", role: "hr" });
    expect(listed.ok && listed.value.map((type) => type.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((await app.certificateTypes.create(({ id: "outsider", role: "pending" } as never), { ...customInput })).ok).toBe(false);
    const created = await app.certificateTypes.create({ id: "admin", role: "admin" }, { ...customInput });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const updated = await app.certificateTypes.update({ id: "admin", role: "admin" }, { id: created.value.id, expectedVersion: 1, name: "Sơ cứu nâng cao", requiredForPositions: ["Nhân viên hiện trường"], sortOrder: 9 });
      expect(updated.ok && updated.value.version).toBe(2);
    }
    const audit = await app.audit.list({ id: "admin", role: "admin" });
    expect(audit.ok && audit.value.map((event) => event.action)).toContain("certificateType.create");
    expect(audit.ok && audit.value.map((event) => event.action)).toContain("certificateType.update");
    if (created.ok) expect(await app.certificateTypes.archive({ id: "admin", role: "admin" }, { id: created.value.id, expectedVersion: 2, reason: "Ngừng sử dụng" })).toMatchObject({ ok: true });
    const finalAudit = await app.audit.list({ id: "admin", role: "admin" });
    expect(finalAudit.ok && finalAudit.value.map((event) => event.action)).toContain("certificateType.archive");
    const activeRows = await app.certificateTypes.list({ id: "hr", role: "hr" });
    expect(activeRows.ok && activeRows.value).toHaveLength(7);
    const adminRows = await app.certificateTypes.list({ id: "admin", role: "admin" }, true);
    expect(adminRows.ok && adminRows.value).toHaveLength(8);
  });

  it("CTYPE_06 uses the exact default role requirements from the supplied table", () => {
    expect(SYSTEM_CERTIFICATE_TYPES[0]?.requiredForPositions).toEqual(allPositions);
    expect(SYSTEM_CERTIFICATE_TYPES[1]?.requiredForPositions).toEqual(allPositions);
    expect(SYSTEM_CERTIFICATE_TYPES[2]?.requiredForPositions).toEqual(managerPositions);
    expect(SYSTEM_CERTIFICATE_TYPES[3]?.requiredForPositions).toEqual(managerPositions);
    expect(SYSTEM_CERTIFICATE_TYPES.slice(4).every((type) => type.requiredForPositions.length === 0)).toBe(true);
    expect(sortCertificateTypes([...SYSTEM_CERTIFICATE_TYPES].reverse()).map((type) => type.key)).toEqual(["atld", "health", "ins", "elec", "weld", "crane", "fork"]);
    const tied = [{ ...SYSTEM_CERTIFICATE_TYPES[0]!, name: "Zeta", sortOrder: 9 }, { ...SYSTEM_CERTIFICATE_TYPES[1]!, name: "Alpha", sortOrder: 9 }, { ...SYSTEM_CERTIFICATE_TYPES[2]!, archived: true }];
    expect(sortCertificateTypes(tied).map((type) => type.name)).toEqual(["Alpha", "Zeta"]);
    const normalizedTie = [
      { ...SYSTEM_CERTIFICATE_TYPES[0]!, id: "z-id", name: "Hòa Phát", sortOrder: 10 },
      { ...SYSTEM_CERTIFICATE_TYPES[1]!, id: "a-id", name: "Hoa Phat", sortOrder: 10 },
    ];
    expect(sortCertificateTypes(normalizedTie).map((type) => type.id)).toEqual(["a-id", "z-id"]);
  });
});
