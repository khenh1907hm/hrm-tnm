import { describe, expect, it } from "vitest";
import type { ProfileTemplateConfig } from "../types";
import { certificateTypeOf, customValues, fieldLabel, isCertificateKey, isCustomKey, profileConfigFromScan } from "./profileConfig";
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
      imageSlots: [{ field: "photo3x4", range: "E8:K16", fit: "cover" }, { field: "cccdImage", range: "C19:Z33", fit: "contain" }],
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
