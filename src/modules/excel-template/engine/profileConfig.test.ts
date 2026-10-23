import { describe, expect, it } from "vitest";
import type { ProfileTemplateConfig } from "../types";
import { certificateTypeOf, cleanProfileConfig, customImageSlots, customValues, fieldKeyFromLabel, fieldLabel, isCertificateKey, isCustomKey, isIdCardImage, isPortraitImage, isSignatureImage, profileConfigFromScan, withoutDuplicatePortraits, targetCellValues, usesSigner } from "./profileConfig";
import type { TemplateScan } from "./scanTemplate";

const scan: TemplateScan = {
  sheetName: "Phieu thong tin",
  placeholders: ["fullNameUpper", "projectStartDate", "contractorName", "cert:atld", "cert:health", "exportDate"],
  printArea: "B1:AZ73",
  imageSlots: [{ field: "photo3x4", range: "E8:K16" }, { field: "cccdImage", range: "C19:Z33" }],
  slotAspect: { photo3x4: 0.75, cccdImage: 1.6 },
};

describe("profileConfigFromScan", () => {
  it("derives custom fields, image fits and attachment order from the template", () => {
    expect(profileConfigFromScan(scan)).toEqual({
      sheetName: "Phieu thong tin", printArea: "B1:AZ73", placeholders: scan.placeholders,
      customFields: [{ key: "projectStartDate", label: "projectStartDate", kind: "date", defaultValue: "" }, { key: "contractorName", label: "contractorName", kind: "text", defaultValue: "" }],
      imageSlots: [{ field: "photo3x4", range: "E8:K16", fit: "stretch" }, { field: "cccdImage", range: "C19:Z33", fit: "stretch" }],
      slotAspect: scan.slotAspect, attachments: ["atld", "health"],
    });
  });

  it("keeps settings from the previous version when the file is uploaded again", () => {
    const previous: ProfileTemplateConfig = {
      ...profileConfigFromScan(scan), printArea: "B1:AZ80", attachments: ["health", "elec"],
      customFields: [{ key: "projectStartDate", label: "Ngày bắt đầu ở dự án", kind: "date", defaultValue: "2026-10-20" }],
      imageSlots: [{ field: "photo3x4", range: "E8:K16", fit: "contain" }],
    };
    const next = profileConfigFromScan({ ...scan, printArea: null }, previous);
    expect(next.printArea).toBe("B1:AZ80");
    expect(next.attachments).toEqual(["health", "elec"]);
    expect(next.customFields[0]).toEqual(previous.customFields[0]);
    expect(next.imageSlots[0]!.fit).toBe("contain");
    expect(profileConfigFromScan({ ...scan, printArea: null }).printArea).toBe("A1:Z60");
  });

  it("re-uploading the file keeps image areas edited in the app (and the chosen signer) instead of the IMG_ names in Excel", () => {
    const previous: ProfileTemplateConfig = {
      ...profileConfigFromScan(scan), signatureId: "sig-1",
      imageSlots: [{ field: "photo3x4", range: "F9:L18", fit: "cover", custom: true }, { field: "cccdImage", range: "C19:Z33", fit: "contain" }, { field: "signature", range: "AD55:AY62", fit: "contain", custom: true }],
    };
    const next = profileConfigFromScan(scan, previous);
    expect(next.imageSlots).toEqual([
      { field: "cccdImage", range: "C19:Z33", fit: "contain" },
      { field: "photo3x4", range: "F9:L18", fit: "cover", custom: true },
      { field: "signature", range: "AD55:AY62", fit: "contain", custom: true },
    ]);
    expect(next.signatureId).toBe("sig-1");
  });
});

describe("field helpers", () => {
  const config = profileConfigFromScan(scan);
  it("classifies keys and builds readable labels", () => {
    expect(isCertificateKey("cert:atld")).toBe(true);
    expect(certificateTypeOf("cert:atld")).toBe("atld");
    expect(isCustomKey("projectStartDate")).toBe(true);
    expect(isCustomKey("fullName")).toBe(false);
    expect(fieldLabel("cert:atld", config, { atld: "An toàn lao động" })).toBe("Ô chứng chỉ An toàn lao động");
    expect(fieldLabel("cert:weld", config)).toBe("Ô chứng chỉ weld");
    expect(fieldLabel("fullNameUpper", config)).toBe("HỌ VÀ TÊN (in hoa)");
    expect(fieldLabel("photo3x4", config)).toBe("Ảnh 3×4 của nhân sự");
    expect(fieldLabel("contractorName", { customFields: [{ key: "contractorName", label: "Tên nhà thầu", kind: "text", defaultValue: "" }] })).toBe("Tên nhà thầu");
    expect(fieldLabel("unknownKey", config)).toBe("unknownKey");
  });

  it("formats custom values with per-export overrides", () => {
    const fields = { customFields: [
      { key: "projectStartDate", label: "Ngày bắt đầu", kind: "date" as const, defaultValue: "2026-10-20" },
      { key: "contractorName", label: "Nhà thầu", kind: "text" as const, defaultValue: "TNM" },
      { key: "hasBadge", label: "Đã cấp thẻ", kind: "checkbox" as const, defaultValue: "true" },
    ] };
    expect(customValues(fields)).toEqual({ projectStartDate: "20/10/2026", contractorName: "TNM", hasBadge: "☑" });
    expect(customValues(fields, { projectStartDate: "2026-11-01", hasBadge: "" })).toEqual({ projectStartDate: "01/11/2026", contractorName: "TNM", hasBadge: "☐" });
  });
});

describe("signer", () => {
  it("needs a signer when the template has {{signer…}} cells or an IMG_signature area; signer keys are not custom fields", () => {
    expect(usesSigner({ placeholders: ["fullName", "signerTitle"], imageSlots: [] })).toBe(true);
    expect(usesSigner({ placeholders: ["fullName"], imageSlots: [{ field: "signature", range: "AB40:AK46", fit: "contain" }] })).toBe(true);
    expect(usesSigner({ placeholders: ["fullName", "exportDate"], imageSlots: [{ field: "photo3x4", range: "A1:B4", fit: "cover" }] })).toBe(false);
    expect(isCustomKey("signerName")).toBe(false);
    expect(fieldLabel("signature", { customFields: [] })).toBe("Ảnh chữ ký người ký");
  });
});

describe("user-defined fields", () => {
  const fields = { customFields: [
    { key: "badgeNo", label: "Số thẻ công trường", kind: "text" as const, defaultValue: "", target: "b12", scope: "employee" as const },
    { key: "badgeDate", label: "Ngày cấp thẻ", kind: "date" as const, defaultValue: "", target: "C12", scope: "employee" as const },
    { key: "contractorLogo", label: "Logo nhà thầu", kind: "image" as const, defaultValue: "data:image/png;base64,AA==", target: "ad54:ay62", scope: "template" as const },
    { key: "badgePhoto", label: "Ảnh thẻ ra vào", kind: "image" as const, defaultValue: "", scope: "employee" as const },
    { key: "projectStartDate", label: "Ngày bắt đầu", kind: "date" as const, defaultValue: "2026-10-20" },
  ] };

  it("reads employee-scoped values from the employee record and skips images", () => {
    expect(customValues(fields, { projectStartDate: "2026-11-01", badgeNo: "bỏ qua" }, { badgeNo: "TK-0099", badgeDate: "2026-09-01" })).toEqual({ badgeNo: "TK-0099", badgeDate: "01/09/2026", projectStartDate: "01/11/2026" });
    expect(customValues(fields)).toEqual({ badgeNo: "", badgeDate: "", projectStartDate: "20/10/2026" });
  });

  it("maps target cells and image ranges", () => {
    expect(targetCellValues(fields, { badgeNo: "TK-0099", badgeDate: "01/09/2026" })).toEqual({ B12: "TK-0099", C12: "01/09/2026" });
    expect(targetCellValues(fields, {})).toEqual({ B12: "", C12: "" });
    expect(customImageSlots(fields)).toEqual([{ field: "contractorLogo", range: "AD54:AY62" }]);
  });

  it("builds readable unique keys from labels and keeps added fields when the file is uploaded again", () => {
    expect(fieldKeyFromLabel("Logo nhà thầu", [])).toBe("logoNhaThau");
    expect(fieldKeyFromLabel("Logo nhà thầu", ["logoNhaThau"])).toBe("logoNhaThau2");
    expect(fieldKeyFromLabel("123 !!!", [])).toBe("truong");
    expect(fieldKeyFromLabel("2 Ảnh thẻ", [])).toBe("anhThe");
    const previous = { ...profileConfigFromScan(scan), customFields: [...profileConfigFromScan(scan).customFields, fields.customFields[0]!] };
    expect(profileConfigFromScan(scan, previous).customFields.map((field) => field.key)).toEqual(["projectStartDate", "contractorName", "badgeNo"]);
  });
});

describe("isIdCardImage", () => {
  it("nhận vùng ảnh CCCD theo khóa hoặc tên trường", () => {
    expect(isIdCardImage("cccdImage", "Ảnh CCCD")).toBe(true);
    expect(isIdCardImage("matTruoc", "Ảnh căn cước mặt trước")).toBe(true);
    expect(isIdCardImage("photo3x4", "Ảnh 3×4 của nhân sự")).toBe(false);
  });
});

describe("isPortraitImage", () => {
  it("nhận vùng ảnh 3×4 theo khóa hoặc tên vùng (vd IMG_3x4 trong Excel)", () => {
    expect(isPortraitImage("photo3x4", "")).toBe(true);
    expect(isPortraitImage("3x4", "3x4")).toBe(true);
    expect(isPortraitImage("anhThe", "Ảnh thẻ")).toBe(true);
    expect(isPortraitImage("cccdImage", "Ảnh CCCD")).toBe(false);
  });
});

describe("cleanProfileConfig", () => {
  it("bỏ trường tùy chỉnh trùng khóa trường hệ thống (mẫu cũ lưu signerName, signerRole như ô nhập tay)", () => {
    const stale: ProfileTemplateConfig = {
      ...profileConfigFromScan(scan),
      customFields: [
        { key: "projectStartDate", label: "Ngày bắt đầu ở dự án", kind: "date", defaultValue: "" },
        { key: "signerName", label: "signerName", kind: "text", defaultValue: "" },
        { key: "signerRole", label: "signerRole", kind: "text", defaultValue: "" },
      ],
    };
    expect(cleanProfileConfig(stale).customFields.map((field) => field.key)).toEqual(["projectStartDate"]);
    const clean = profileConfigFromScan(scan);
    expect(cleanProfileConfig(clean)).toBe(clean);
  });
});

describe("withoutDuplicatePortraits", () => {
  const config = { customFields: [] };
  it("bỏ vùng 3x4 trùng khi mẫu đã có IMG_photo3x4, để ảnh 3×4 không bị chèn hai lần", () => {
    const slots = [{ field: "photo3x4", range: "E8:K16" }, { field: "cccdImage", range: "C19:Z33" }, { field: "3x4", range: "E8" }];
    expect(withoutDuplicatePortraits(slots, config).map((slot) => slot.field)).toEqual(["photo3x4", "cccdImage"]);
  });

  it("giữ vùng 3x4 khi mẫu không có IMG_photo3x4", () => {
    const slots = [{ field: "3x4", range: "E8" }, { field: "cccdImage", range: "C19:Z33" }];
    expect(withoutDuplicatePortraits(slots, config)).toEqual(slots);
  });
});

describe("isSignatureImage", () => {
  it("nhận ảnh chữ ký theo khóa hoặc tên trường", () => {
    expect(isSignatureImage("signature", "Ảnh chữ ký người ký")).toBe(true);
    expect(isSignatureImage("employeeSignature", "")).toBe(true);
    expect(isSignatureImage("chuKyChiHuy", "Chữ ký chỉ huy trưởng")).toBe(true);
    expect(isSignatureImage("cccdImage", "Ảnh CCCD")).toBe(false);
    expect(isSignatureImage("photo3x4", "Ảnh 3×4 của nhân sự")).toBe(false);
  });
});
