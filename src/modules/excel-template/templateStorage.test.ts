import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  createDefaultDemoTemplate,
  duplicateTemplate,
  uint8ArrayToBase64,
} from "./templateStorage";

describe("templateStorage utilities", () => {
  it("uint8ArrayToBase64 and base64ToUint8Array roundtrip converts binary data accurately", () => {
    const original = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"
    const b64 = uint8ArrayToBase64(original);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);

    const restored = base64ToUint8Array(b64);
    expect(restored).toEqual(original);
  });

  it("createDefaultDemoTemplate returns valid default template with mappings", async () => {
    const template = await createDefaultDemoTemplate();
    expect(template.id).toBe("default-starter-template");
    expect(template.name).toContain("Phiếu thông tin nhân sự");
    expect(template.mappings.length).toBeGreaterThanOrEqual(10);
    expect(template.fileBase64.length).toBeGreaterThan(100);

    const codeMapping = template.mappings.find((m) => m.field === "code");
    expect(codeMapping?.cell).toBe("C5");

    const nameMapping = template.mappings.find((m) => m.field === "name");
    expect(nameMapping?.cell).toBe("C6");
  });
});

describe("duplicateTemplate", () => {
  it("giữ nguyên file và cấu hình, đổi id, đặt tên bản sao không trùng", async () => {
    const original = { ...await createDefaultDemoTemplate(), id: "tpl-a", name: "Hồ sơ Vinci" };
    const copy = duplicateTemplate(original, [original], "tpl-b", "2026-10-27T10:00:00.000Z");
    expect(copy).toMatchObject({ id: "tpl-b", name: "Hồ sơ Vinci (bản sao)", fileBase64: original.fileBase64, mappings: original.mappings, createdAt: "2026-10-27T10:00:00.000Z" });
    // Sửa bản sao không ảnh hưởng bản gốc
    copy.mappings.push({ cell: "Z9", field: "name" } as (typeof copy.mappings)[number]);
    expect(original.mappings).not.toContain(copy.mappings.at(-1));
    const third = duplicateTemplate(original, [original, copy], "tpl-c", "2026-10-27T10:01:00.000Z");
    expect(third.name).toBe("Hồ sơ Vinci (bản sao 2)");
  });
});
