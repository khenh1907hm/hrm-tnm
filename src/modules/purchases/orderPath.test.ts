import { describe, expect, it } from "vitest";
import { orderPath, paymentTermsLabel } from "./flow";

const keys = (steps: ReturnType<typeof orderPath>) => steps.map((step) => step.key);

describe("orderPath: các bước của đơn theo điều kiện thanh toán", () => {
  it("thanh toán sau khi nhận hàng: không tạm ứng / trả trước, có hóa đơn chứng từ rồi đề nghị thanh toán", () => {
    const steps = orderPath({ status: "approved", usesChain: true, advanceRequired: false, prepayRequired: false }, []);
    expect(keys(steps)).toEqual(["draft", "submitted", "approved", "po", "ordered", "received", "stocked", "docs", "final", "final_pay", "completed"]);
    expect(steps.find((step) => step.key === "po")?.state).toBe("current");
    expect(paymentTermsLabel({ advanceRequired: false, prepayRequired: false })).toBe("Thanh toán sau khi nhận hàng");
  });

  it("thanh toán trước khi nhận hàng + tạm ứng: có bước tạm ứng và trả trước, không có thanh toán cuối", () => {
    const steps = orderPath({ status: "approved", usesChain: true, advanceRequired: true, advancePct: 30, prepayRequired: true, poIssuedAt: "x", supplierAcceptedAt: "x" }, []);
    expect(keys(steps)).toEqual(["draft", "submitted", "approved", "po", "advance", "advance_pay", "ordered", "prepayment", "prepayment_pay", "received", "stocked", "docs", "completed"]);
    expect(steps.find((step) => step.state === "current")?.key).toBe("advance");
    expect(paymentTermsLabel({ advanceRequired: true, advancePct: 30, prepayRequired: true })).toBe("Thanh toán trước khi nhận hàng · Tạm ứng 30%");
  });

  it("trước khi nhận hàng, không tạm ứng; nhập kho xong thì đang ở bước hóa đơn chứng từ cho kho", () => {
    const steps = orderPath({ status: "received", usesChain: true, advanceRequired: false, prepayRequired: true, stockedAt: "x" }, [{ kind: "prepayment", status: "paid" }]);
    expect(keys(steps)).not.toContain("advance");
    expect(steps.find((step) => step.key === "prepayment_pay")?.state).toBe("done");
    expect(steps.find((step) => step.state === "current")?.key).toBe("docs");
  });

  it("đơn văn phòng (không chuỗi ký) không có bước PO; đơn hoàn tất không còn bước đang ở", () => {
    const steps = orderPath({ status: "completed", usesChain: false, docsCollectedAt: "x" }, [{ kind: "final", status: "paid" }]);
    expect(keys(steps)).not.toContain("po");
    expect(steps.some((step) => step.state === "current")).toBe(false);
    expect(steps.at(-1)?.state).toBe("done");
  });
});
