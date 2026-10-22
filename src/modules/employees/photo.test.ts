import { describe, expect, it } from "vitest";
import { isLegacyPhoto, photoRef } from "./photo";
import { employeeInputSchema } from "./schema";

const ref = { id: "photo-1", name: "anh.jpg", mime: "image/jpeg", size: 2048 };
const input = { code: "TNM100", name: "Trần Văn Ảnh", dob: "1995-03-20", gender: "Nam", cccd: "001095123456", phone: "0912345678", home: "", address: "", position: "Nhân viên hiện trường", group: null, startDate: "2024-01-15", emergencyContactId: null, status: "active", endDate: null };

describe("employee portrait photo", () => {
  it("tells stored file references apart from legacy data URLs", () => {
    expect(photoRef(ref)).toEqual(ref);
    expect(photoRef("data:image/png;base64,AAAA")).toBeNull();
    expect(photoRef(null)).toBeNull();
    expect(photoRef(undefined)).toBeNull();
    expect(isLegacyPhoto("data:image/png;base64,AAAA")).toBe(true);
    expect(isLegacyPhoto(ref)).toBe(false);
    expect(isLegacyPhoto(null)).toBe(false);
  });

  it("accepts only file references when writing, never base64 inside the record", () => {
    expect(employeeInputSchema.safeParse({ ...input, photo: ref }).success).toBe(true);
    expect(employeeInputSchema.safeParse({ ...input, photo: null }).success).toBe(true);
    expect(employeeInputSchema.safeParse(input).success).toBe(true);
    expect(employeeInputSchema.safeParse({ ...input, photo: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(employeeInputSchema.safeParse({ ...input, photo: { ...ref, mime: "application/pdf" } }).success).toBe(false);
    expect(employeeInputSchema.safeParse({ ...input, photo: { ...ref, size: 11 * 1024 * 1024 } }).success).toBe(false);
  });
});
