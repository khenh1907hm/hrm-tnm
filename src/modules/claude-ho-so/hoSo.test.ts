import { describe, expect, it } from "vitest";
import type { Employee } from "../employees/types";
import {
  HO_SO_FIELD_LABELS, HO_SO_MAX_PHOTO, applyHoSoChanges, base64ByteLength, buildNewEmployeeInput, diffHoSo, newEmployeeRecord,
  nextEmployeeCode, parseHoSoFile, photoSignatureMatches, planHoSo, updatedEmployeeRecord, type HoSoFile, type HoSoPlan,
} from "./hoSo";

const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1));
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XWcz8AAAAASUVORK5CYII=";
const WEBP = btoa("RIFF$\u0000\u0000\u0000WEBPVP8 ");
const TODAY = "2026-10-21";

const fileJson = (patch: Record<string, unknown> = {}, employee: Record<string, unknown> = {}) => JSON.stringify({
  format: "tnm-ho-so", version: 1, createdAt: "2026-10-21T03:00:00Z",
  employee: { name: "Nguyễn Thị Thu", cccd: "079195000001", dob: "1995-03-12", gender: "Nữ", home: "Xã Tân Phú, Tỉnh Đồng Nai", address: "Phường Bình Trị Đông, TP Hồ Chí Minh", position: "Nhân viên kỹ thuật", ...employee },
  photo: { mime: "image/jpeg", name: "anh-3x4.jpg", base64: JPEG },
  notes: ["Ảnh hơi tối", 3, "  "],
  ...patch,
});
const parsed = (patch?: Record<string, unknown>, employee?: Record<string, unknown>): HoSoFile => {
  const result = parseHoSoFile(fileJson(patch, employee));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};

/** Thu hẹp kiểu kế hoạch về "cập nhật hồ sơ đã có" (báo lỗi nếu không phải). */
const existingPlan = (plan: HoSoPlan) => {
  if (plan.kind !== "existing") throw new Error("expected existing plan");
  return plan;
};

const employee = (patch: Partial<Employee> = {}): Employee => ({
  id: "e1", version: 3, code: "TNM101", name: "Nguyễn Thị Thu", dob: "1995-03-12", gender: "Nữ", cccd: "079195000001", phone: "0912345678",
  home: "Xã Tân Phú, Tỉnh Đồng Nai", address: "Phường Bình Trị Đông, TP Hồ Chí Minh", position: "Nhân viên kỹ thuật", group: 2,
  startDate: "2020-01-01", emergencyContactId: null, status: "active", endDate: null, archivedAt: null, archivedBy: null, archiveReason: null,
  cccdMismatchOverrideReason: null, photo: { id: "p1", name: "anh-3x4-TNM101.jpg", mime: "image/jpeg", size: 100 }, ...patch,
});

describe("HOSO file", () => {
  it("HOSO_01 reads a valid file and normalises fields", () => {
    const file = parsed({}, { name: "  Nguyễn   Thị Thu ", cccd: "079 195 000 001" });
    expect(file.employee).toMatchObject({ name: "Nguyễn Thị Thu", cccd: "079195000001", phone: "", currentAddress: "", startDate: "" });
    expect(file.notes).toEqual(["Ảnh hơi tối"]);
    expect(file.photo).toMatchObject({ mime: "image/jpeg", name: "anh-3x4.jpg", size: base64ByteLength(JPEG) });
    expect(parseHoSoFile(fileJson({ notes: "x", photo: { mime: "image/png", base64: PNG } })).ok).toBe(true);
    const noName = parseHoSoFile(fileJson({ notes: undefined, photo: { mime: "image/png", base64: PNG, name: 5 } }));
    expect(noName.ok && noName.value.photo.name).toBe("anh-3x4");
    expect(noName.ok && noName.value.notes).toEqual([]);
  });

  it("HOSO_01 rejects malformed files, other versions and bad photos", () => {
    const code = (raw: string) => { const result = parseHoSoFile(raw); return result.ok ? "ok" : result.errors[0]!.code; };
    expect(code("không phải json")).toBe("HOSO_FILE_INVALID");
    expect(code("[]")).toBe("HOSO_FILE_INVALID");
    expect(code(fileJson({ format: "khac" }))).toBe("HOSO_FILE_INVALID");
    expect(code(fileJson({ employee: "x" }))).toBe("HOSO_FILE_INVALID");
    expect(code(fileJson({ version: 2 }))).toBe("HOSO_FILE_VERSION");
    expect(code(fileJson({ photo: null }))).toBe("HOSO_PHOTO_INVALID");
    expect(code(fileJson({ photo: { mime: "image/gif", base64: JPEG } }))).toBe("HOSO_PHOTO_INVALID");
    expect(code(fileJson({ photo: { mime: "image/jpeg", base64: "" } }))).toBe("HOSO_PHOTO_INVALID");
    expect(code(fileJson({ photo: { mime: "image/jpeg", base64: "@@@@" } }))).toBe("HOSO_PHOTO_INVALID");
    expect(code(fileJson({ photo: { mime: "image/png", base64: JPEG } }))).toBe("HOSO_PHOTO_INVALID");
    expect(code(fileJson({ photo: { mime: "image/jpeg", base64: JPEG + "A".repeat(Math.ceil(HO_SO_MAX_PHOTO * 4 / 3)) } }))).toBe("HOSO_PHOTO_INVALID");
  });

  it("HOSO_01 checks file signatures and decoded size", () => {
    expect(photoSignatureMatches(JPEG, "image/jpeg")).toBe(true);
    expect(photoSignatureMatches(PNG, "image/png")).toBe(true);
    expect(photoSignatureMatches(WEBP, "image/webp")).toBe(true);
    expect(photoSignatureMatches(PNG, "image/webp")).toBe(false);
    expect(photoSignatureMatches("%%%", "image/jpeg")).toBe(false);
    expect(base64ByteLength("QQ==")).toBe(1);
    expect(base64ByteLength("QUI=")).toBe(2);
    expect(base64ByteLength("QUJD")).toBe(3);
  });
});

describe("HOSO codes", () => {
  it("HOSO_02 next code follows the highest TNM number including archived", () => {
    expect(nextEmployeeCode(["TNM101", "TNM130", "tnm19007 ", "ABC999999", "TNM03107"])).toBe("TNM19008");
    expect(nextEmployeeCode([])).toBe("TNM001");
    expect(nextEmployeeCode(["TNM9"])).toBe("TNM010");
    expect(nextEmployeeCode(["TNM99999"])).toBeNull();
  });
});

describe("HOSO plan", () => {
  it("HOSO_04 new employee is validated like manual entry and needs a phone", () => {
    const file = parsed();
    const noPhone = planHoSo(file, {}, [employee({ id: "x", cccd: "001095000009", code: "TNM130" })], TODAY, []);
    expect(noPhone).toMatchObject({ kind: "new", code: "TNM131" });
    expect(noPhone.errors.map((item) => item.code)).toEqual(["PHONE_REQUIRED"]);
    const ok = planHoSo(file, { phone: "+84 912 345 679", startDate: "2026-10-01", group: 3 }, [], TODAY, []);
    expect(ok.errors).toEqual([]);
    expect(ok.input).toMatchObject({ code: "TNM001", phone: "0912345679", startDate: "2026-10-01", group: 3, status: "active" });
    expect(ok.input).not.toHaveProperty("currentAddress");
  });

  it("HOSO_04 refuses CCCD mismatches, bad positions, duplicate phones only warn", () => {
    const mismatch = planHoSo(parsed({}, { cccd: "079095000001" }), { phone: "0912345679" }, [], TODAY, []);
    expect(mismatch.errors.map((item) => item.code)).toEqual(["CCCD_GENDER_MISMATCH"]);
    const badPosition = planHoSo(parsed({}, { position: "Thợ hàn" }), { phone: "0912345679" }, [], TODAY, []);
    expect(badPosition.errors.map((item) => item.code)).toEqual(["EMP_POSITION_INVALID"]);
    const dupPhone = planHoSo(parsed(), { phone: "0912345678" }, [employee({ cccd: "001095000009" })], TODAY, []);
    expect(dupPhone.errors).toEqual([]);
    expect(dupPhone.warnings.map((item) => item.code)).toContain("PHONE_DUPLICATE");
    const badGender = planHoSo(parsed({}, { gender: "Khác" }), { phone: "0912345679" }, [], TODAY, []);
    expect(badGender.errors.map((item) => item.code)).toEqual(["EMP_INPUT_INVALID"]);
    const badGroup = planHoSo(parsed(), { phone: "0912345679", group: 9 }, [], TODAY, []);
    expect(badGroup.errors.map((item) => item.code)).toEqual(["EMP_GROUP_INVALID"]);
    const exhausted = planHoSo(parsed(), { phone: "0912345679" }, [employee({ cccd: "001095000009", code: "TNM99999" })], TODAY, []);
    expect(exhausted).toMatchObject({ kind: "new", code: "", errors: [{ code: "HOSO_CODE_EXHAUSTED" }] });
  });

  it("HOSO_03 existing CCCD only changes differing filled fields and keeps the rest", () => {
    const current = employee({ name: "NGUYỄN THỊ THU", phone: "0912 345 678", currentAddress: "Cũ" });
    const file = parsed({}, { address: "Địa chỉ mới", currentAddress: "", startDate: "2026-01-01" });
    const plan = existingPlan(planHoSo(file, {}, [current], TODAY, []));
    expect(plan.changes).toEqual([
      { field: "address", old: "Phường Bình Trị Đông, TP Hồ Chí Minh", new: "Địa chỉ mới" },
      { field: "photo", old: "Có ảnh", new: "Ảnh mới" },
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.input).toMatchObject({ code: "TNM101", startDate: "2020-01-01", group: 2, currentAddress: "Cũ", address: "Địa chỉ mới" });
    const record = updatedEmployeeRecord(current, plan.input, plan.changes, { id: "p2", name: "anh-3x4-TNM101.jpg", mime: "image/jpeg", size: 9 });
    expect(record).toMatchObject({ version: 4, address: "Địa chỉ mới", name: "NGUYỄN THỊ THU", startDate: "2020-01-01", photo: { id: "p2" } });
  });

  it("HOSO_03 photo-only and phone overrides on existing records", () => {
    const current = employee({ photo: null });
    const photoOnly = existingPlan(planHoSo(parsed(), {}, [current], TODAY, []));
    expect(photoOnly.changes).toEqual([{ field: "photo", old: null, new: "Ảnh mới" }]);
    expect(photoOnly.errors).toEqual([]);
    expect(existingPlan(planHoSo(parsed(), {}, [current], TODAY, [], false)).changes).toEqual([]);
    expect(() => existingPlan(planHoSo(parsed(), {}, [], TODAY, []))).toThrow();
    const withPhone = diffHoSo(current, parsed(), { phone: "0987654321" }, false);
    expect(withPhone).toEqual([{ field: "phone", old: "0912345678", new: "0987654321" }]);
    expect(diffHoSo(employee(), parsed({}, { currentAddress: "Chỗ ở mới" }), {}, false)).toEqual([{ field: "currentAddress", old: null, new: "Chỗ ở mới" }]);
    const legacy = employee({ phone: "", currentAddress: "x" });
    const invalid = planHoSo(parsed({}, { address: "Mới" }), {}, [legacy], TODAY, []);
    expect(invalid.errors.map((item) => item.code)).toEqual(["PHONE_REQUIRED"]);
    const badShape = planHoSo(parsed({}, { position: "Bảo vệ" }), {}, [employee()], TODAY, []);
    expect(badShape.errors.map((item) => item.code)).toEqual(["EMP_POSITION_INVALID"]);
    expect(updatedEmployeeRecord(current, applyHoSoChanges(current, []), [], null).photo).toBeNull();
  });

  it("HOSO_04 records are built in the web storage shape", () => {
    const input = buildNewEmployeeInput(parsed({}, { currentAddress: "Chỗ ở", phone: "0912345679", startDate: "2026-02-02" }), {}, "TNM200", TODAY);
    expect(input).toMatchObject({ currentAddress: "Chỗ ở", phone: "0912345679", startDate: "2026-02-02", group: null, emergencyContactId: null });
    const record = newEmployeeRecord({ ...input, mismatchOverrideReason: "" }, "id-1", null);
    expect(record).toMatchObject({ id: "id-1", version: 1, code: "TNM200", archivedAt: null, cccdMismatchOverrideReason: null, photo: null });
    expect(record).not.toHaveProperty("mismatchOverrideReason");
    expect(applyHoSoChanges(employee({ currentAddress: "" }), [{ field: "home", old: "a", new: null }])).toMatchObject({ home: "" });
    expect(Object.keys(HO_SO_FIELD_LABELS)).toHaveLength(9);
  });
});
