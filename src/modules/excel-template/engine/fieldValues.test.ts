import { describe, expect, it } from "vitest";
import type { Certificate } from "../../certificates/types";
import type { Commander } from "../../commanders/types";
import type { Employee } from "../../employees/types";
import { ageOn, buildSystemValues, formatCustomValue, hasValidCertificate, resolveLayers, SYSTEM_FIELDS } from "./fieldValues";
import { readImageInfo } from "./imageSize";

const employee: Employee = { id: "e1", code: "TNM001", name: "Nguyễn Minh An", dob: "1988-05-12", gender: "Nam", cccd: "079088000001", phone: "0830000001", home: "Xã Hoằng Phú, Tỉnh Thanh Hóa", address: "Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng", currentAddress: "12 Lê Lợi, TP.HCM", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-15", emergencyContactId: "cmd-1", status: "active", endDate: null, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, version: 1 };
const commander: Commander = { id: "cmd-1", name: "Phạm Văn Sơn", role: "Chỉ huy trưởng công trường", phone: "0902000111", address: "8 đường Mẫu, TP.HCM", archived: false, version: 1 };
const certificate = (type: string, expiryDate: string, state: Certificate["state"] = "current"): Certificate => ({ id: `${type}-${expiryDate}`, employeeId: "e1", type, title: "", number: "S-1", expiryDate, issueDate: null, document: { id: "f", name: "f.png", mime: "image/png", size: 1 }, supplementaryFiles: [], state, version: 1, replacedBy: null, archiveReason: null });

describe("buildSystemValues", () => {
  it("formats employee, computed, contact and certificate fields for the template", () => {
    const values = buildSystemValues({ employee, commander, certificates: [certificate("atld", "2027-03-15"), certificate("health", "2026-10-13"), certificate("elec", "2027-01-01", "archived")], certificateTypes: ["atld", "health", "elec", "weld"], exportDate: "2026-10-14" });
    expect(values).toMatchObject({
      code: "TNM001", fullName: "Nguyễn Minh An", fullNameUpper: "NGUYỄN MINH AN", dob: "12/05/1988", genderMale: "☑", genderFemale: "☐",
      currentAddress: "12 Lê Lợi, TP.HCM", startDate: "15/01/2020", safetyGroup: "Nhóm 3", age: "38", experience: "6 năm 8 tháng", exportDate: "14/10/2026",
      contactName: "Phạm Văn Sơn", contactNameUpper: "PHẠM VĂN SƠN", contactRelation: "Chỉ huy trưởng công trường", contactPhone: "0902000111", contactAddress: "8 đường Mẫu, TP.HCM",
      "cert:atld": "☑", "cert:health": "☐", "cert:elec": "☐", "cert:weld": "☐",
    });
    for (const field of SYSTEM_FIELDS) expect(values).toHaveProperty(field.key);
  });

  it("leaves optional values empty when they are missing", () => {
    const female: Employee = { ...employee, gender: "Nữ", group: null, startDate: "2026-12-01" };
    delete female.currentAddress;
    const values = buildSystemValues({ employee: female, commander: null, certificates: [], certificateTypes: [], exportDate: "2026-10-14" });
    expect(values).toMatchObject({ genderMale: "☐", genderFemale: "☑", safetyGroup: "", currentAddress: "", experience: "", contactName: "", contactNameUpper: "", contactRelation: "", contactPhone: "", contactAddress: "" });
  });

  it("fills the signer chosen from the signature library (name, role, 'name - role'), empty when none", () => {
    const signed = buildSystemValues({ employee, commander, signer: { name: "Nguyễn Gia Luân", role: "Giám Đốc" }, certificates: [], certificateTypes: [], exportDate: "2026-10-14" });
    expect(signed).toMatchObject({ signerName: "Nguyễn Gia Luân", signerNameUpper: "NGUYỄN GIA LUÂN", signerRole: "Giám Đốc", signerTitle: "Nguyễn Gia Luân - Giám Đốc" });
    expect(buildSystemValues({ employee, commander, signer: { name: "Lê Văn Ký", role: "" }, certificates: [], certificateTypes: [], exportDate: "2026-10-14" }).signerTitle).toBe("Lê Văn Ký");
    expect(buildSystemValues({ employee, commander, certificates: [], certificateTypes: [], exportDate: "2026-10-14" })).toMatchObject({ signerName: "", signerNameUpper: "", signerRole: "", signerTitle: "" });
  });

  it("computes age around the birthday and validity on the export date", () => {
    expect(ageOn("1988-05-12", "2026-05-11")).toBe(37);
    expect(ageOn("1988-05-12", "2026-05-12")).toBe(38);
    expect(hasValidCertificate([certificate("atld", "2026-10-14")], "atld", "2026-10-14")).toBe(true);
    expect(hasValidCertificate([certificate("atld", "2026-10-14", "replaced")], "atld", "2026-10-14")).toBe(false);
  });
});

describe("custom values and layers", () => {
  it("formats custom field values by kind", () => {
    expect(formatCustomValue("date", "2026-10-20")).toBe("20/10/2026");
    expect(formatCustomValue("text", "Dự án Taikisha")).toBe("Dự án Taikisha");
    expect(formatCustomValue("text", "")).toBe("");
    expect(formatCustomValue("date", null)).toBe("");
    expect(formatCustomValue("checkbox", true)).toBe("☑");
    expect(formatCustomValue("checkbox", false)).toBe("☐");
  });

  it("applies template values, then project variables, then per-person overrides", () => {
    const template = { projectStartDate: "01/10/2026", contractor: "Thiên Nhật Minh", note: "Mặc định" };
    const project = { projectStartDate: "20/10/2026", note: "" };
    const person = { projectStartDate: "01/11/2026" };
    expect(resolveLayers(template, project, person)).toEqual({ projectStartDate: "01/11/2026", contractor: "Thiên Nhật Minh", note: "Mặc định" });
    expect(resolveLayers(template, project)).toMatchObject({ projectStartDate: "20/10/2026" });
  });
});

describe("readImageInfo", () => {
  it("reads PNG and JPEG dimensions from the header", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 600);
    new DataView(png.buffer).setUint32(20, 800);
    expect(readImageInfo(png)).toEqual({ extension: "png", width: 600, height: 800 });

    // SOI · APP0 (dài 16) · SOF0: cao 400, rộng 300
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(readImageInfo(jpeg)).toEqual({ extension: "jpeg", width: 300, height: 400 });
  });

  it("returns null for unknown or broken images", () => {
    expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readImageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0x00, 0x00, ...new Array(12).fill(0)]))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0, 0, 0xff, 0xd9, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
