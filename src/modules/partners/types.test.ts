import { describe, expect, it } from "vitest";
import { dataUrlBytes, sortPartners, validatePartner, type Partner } from "./types";

const png = "data:image/png;base64,iVBORw0KGgo=";
const existing: Partner[] = [{ id: "p1", name: "Taikisha Việt Nam", image: png }];

describe("đối tác", () => {
  it("bắt buộc tên, không trùng tên (không phân biệt dấu, hoa thường), cho sửa chính nó", () => {
    expect(validatePartner({ name: "  ", image: "" }, existing)).toBe("Nhập tên đối tác.");
    expect(validatePartner({ name: "taikisha viet nam", image: "" }, existing)).toBe("Đã có đối tác cùng tên.");
    expect(validatePartner({ id: "p1", name: "Taikisha Việt Nam", image: png }, existing)).toBeNull();
    expect(validatePartner({ name: "TVE", image: "" }, existing)).toBeNull();
    expect(validatePartner({ name: "x".repeat(201), image: "" }, existing)).toContain("tối đa");
  });

  it("ảnh chỉ nhận PNG/JPG dạng data URL, tối đa 2 MB", () => {
    expect(validatePartner({ name: "A", image: "data:image/gif;base64,R0lG" }, [])).toBe("Ảnh phải là PNG hoặc JPG.");
    expect(validatePartner({ name: "A", image: "https://example.com/a.png" }, [])).toBe("Ảnh phải là PNG hoặc JPG.");
    const big = `data:image/jpeg;base64,${"A".repeat(Math.ceil(2 * 1024 * 1024 * 4 / 3) + 8)}`;
    expect(validatePartner({ name: "A", image: big }, [])).toBe("Ảnh tối đa 2 MB.");
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
  });

  it("sắp theo tên tiếng Việt", () => {
    const sorted = sortPartners([{ id: "2", name: "Đông Á", image: "" }, { id: "1", name: "an phát", image: "" }, { id: "3", name: "Bảo Long", image: "" }]);
    expect(sorted.map((partner) => partner.name)).toEqual(["an phát", "Bảo Long", "Đông Á"]);
  });
});
