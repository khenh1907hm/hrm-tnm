import { describe, expect, it } from "vitest";
import { checkIdImages } from "./imageFiles";

describe("checkIdImages", () => {
  it("accepts a supported image under the size limit", () => {
    expect(checkIdImages([{ name: "front.webp", type: "image/webp", size: 1024 }]).valid).toHaveLength(1);
  });

  it("rejects unsupported and oversized files while keeping valid ones", () => {
    const result = checkIdImages([{ name: "front.jpg", type: "image/jpeg", size: 20 }, { name: "scan.pdf", type: "application/pdf", size: 20 }, { name: "large.png", type: "image/png", size: 11 * 1024 * 1024 }]);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected.map((item) => item.reason)).toEqual(["type", "size"]);
  });
});
