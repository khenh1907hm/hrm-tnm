import { describe, expect, it } from "vitest";
import { FLOW_GROUPS, groupOfStep, orderGroup } from "./flow";

describe("thanh quy trình mua hàng của dự án", () => {
  it("13 khối: YCVT đứng đầu, mỗi cặp đề nghị → chi gộp một khối", () => {
    expect(FLOW_GROUPS.map((group) => group.key)).toEqual(["material", "draft", "submitted", "approved", "po", "advance", "ordered", "prepayment", "received", "stocked", "docs", "final", "completed"]);
    expect(groupOfStep("advance_pay")).toBe("advance");
    expect(groupOfStep("final_pay")).toBe("final");
    expect(groupOfStep("ordered")).toBe("ordered");
  });
  it("mỗi đơn nằm ở khối của bước hiện tại; hoàn tất / hủy nằm ở Hoàn tất", () => {
    expect(orderGroup({ status: "draft", usesChain: true }, [])).toBe("draft");
    expect(orderGroup({ status: "approved", usesChain: true, advanceRequired: true, prepayRequired: true, poIssuedAt: "x", supplierAcceptedAt: "x" }, [{ kind: "advance", status: "approved" }])).toBe("advance");
    expect(orderGroup({ status: "received", usesChain: true, stockedAt: "x" }, [])).toBe("docs");
    expect(orderGroup({ status: "cancelled", usesChain: true }, [])).toBe("completed");
  });
});
