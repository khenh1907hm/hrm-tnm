import { describe, expect, it } from "vitest";
import { finalQuotePrice } from "./quoteParse";

const base = { subtotal: null, vat: null, total: null, vatIncluded: null, items: [] as { name: string; spec: string; unit: string; quantity: number; unitPrice: number; amount: number }[] };

describe("finalQuotePrice", () => {
  it("ưu tiên tổng trước thuế", () => expect(finalQuotePrice({ ...base, subtotal: 1000, vat: 80, total: 1080 })).toEqual({ amount: 1000, from: "subtotal" }));
  it("tổng cộng trừ VAT khi không có tổng trước thuế", () => expect(finalQuotePrice({ ...base, vat: 80, total: 1080 })).toEqual({ amount: 1000, from: "total" }));
  it("báo giá chưa gồm VAT thì lấy tổng cộng", () => expect(finalQuotePrice({ ...base, vat: 80, total: 1000, vatIncluded: false })).toEqual({ amount: 1000, from: "total" }));
  it("không có tổng thì cộng các dòng", () => expect(finalQuotePrice({ ...base, items: [{ name: "a", spec: "", unit: "", quantity: 2, unitPrice: 50, amount: 100 }] })).toEqual({ amount: 100, from: "items" }));
  it("không có gì thì null", () => expect(finalQuotePrice(base)).toBeNull());
});
