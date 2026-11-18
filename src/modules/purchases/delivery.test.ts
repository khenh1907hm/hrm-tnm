import { describe, expect, it } from "vitest";
import { deliveryAddressFor, deliveryKindOf, OFFICE_ADDRESS } from "./delivery";

describe("Giao tới: Văn phòng / Dự án / Khác", () => {
  it("điền địa chỉ theo loại và đọc lại được loại", () => {
    const office = deliveryAddressFor("office", null);
    expect(office).toContain(OFFICE_ADDRESS);
    expect(deliveryKindOf(office)).toBe("office");
    const site = deliveryAddressFor("project", { code: "Pr25001-01", site: "KCN Đà Nẵng" });
    expect(site).toBe("Dự án Pr25001-01: KCN Đà Nẵng");
    expect(deliveryKindOf(site)).toBe("project");
    expect(deliveryKindOf("Kho ông Ba, Q.7")).toBe("other");
    expect(deliveryKindOf("", "project")).toBe("project");
  });
  it("chuyển sang Khác thì bỏ địa chỉ tự điền", () => {
    expect(deliveryAddressFor("other", null, "Văn phòng: x")).toBe("");
    expect(deliveryAddressFor("other", null, "Kho ông Ba")).toBe("Kho ông Ba");
  });
});
