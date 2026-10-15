import { describe, expect, it } from "vitest";
import { correctVietnameseNameTones } from "./name";

describe("correctVietnameseNameTones", () => {
  it("keeps valid names unchanged", () => {
    expect(correctVietnameseNameTones("NGUYỄN HOÀNG MINH")).toBe("NGUYỄN HOÀNG MINH");
    expect(correctVietnameseNameTones("Trần Thị Bình")).toBe("Trần Thị Bình");
  });

  it("keeps vowel modifiers together with a single tone mark", () => {
    expect(correctVietnameseNameTones("Nguyệt Hằng Phượng")).toBe("Nguyệt Hằng Phượng");
  });

  it("drops extra tone marks that OCR stacked on one syllable", () => {
    expect(correctVietnameseNameTones("Tra\u0300\u0301n Thi\u0323\u0300")).toBe("Tràn Thị");
  });

  it("restores the tone of common family names misread by OCR, but never in the given name", () => {
    expect(correctVietnameseNameTones("LÊ NGUYÊN HOÀNG MINH")).toBe("LÊ NGUYỄN HOÀNG MINH");
    expect(correctVietnameseNameTones("Lê Nguyên Hoàng")).toBe("Lê Nguyễn Hoàng");
    expect(correctVietnameseNameTones("Trần Nguyên")).toBe("Trần Nguyên");
  });
});
