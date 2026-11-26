import { describe, expect, it } from "vitest";
import { eventStep } from "./flow";

describe("eventStep: hoạt động thuộc bước nào", () => {
  it("các bước chính", () => {
    expect(eventStep({ action: "submit", at: "" })).toBe("submitted");
    expect(eventStep({ action: "sign:leader", at: "" })).toBe("submitted");
    expect(eventStep({ action: "issue_po", at: "" })).toBe("po");
    expect(eventStep({ action: "track", at: "" })).toBe("ordered");
    expect(eventStep({ action: "stock_in", at: "" })).toBe("stocked");
    expect(eventStep({ action: "collect_docs", at: "" })).toBe("docs");
    expect(eventStep({ action: "paid:advance", at: "" })).toBe("advance_pay");
    expect(eventStep({ action: "payment_request:prepayment", at: "" })).toBe("prepayment");
  });
  it("ký đề nghị thanh toán theo đề nghị gần nhất trước đó", () => {
    const payments = [{ kind: "advance" as const, requestedAt: "2026-11-01T00:00:00Z" }, { kind: "final" as const, requestedAt: "2026-11-20T00:00:00Z" }];
    expect(eventStep({ action: "payment_sign:pic", at: "2026-11-05T00:00:00Z" }, payments)).toBe("advance");
    expect(eventStep({ action: "payment_sign:pic", at: "2026-11-21T00:00:00Z" }, payments)).toBe("final");
  });
});
