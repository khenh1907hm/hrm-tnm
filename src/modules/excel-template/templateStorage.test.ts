import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  createDefaultDemoTemplate,
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
