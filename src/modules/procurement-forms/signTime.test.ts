import { describe, expect, it } from "vitest";
import { vnDateTime } from "./forms";

describe("vnDateTime (thời gian duyệt in dưới tên trong ô ký)", () => {
  it("đổi mốc UTC sang giờ Việt Nam dạng dd/mm/yyyy HH:mm", () => {
    expect(vnDateTime("2026-11-12T03:05:00Z")).toBe("12/11/2026 10:05");
    expect(vnDateTime("2026-11-12T18:30:00+00:00")).toBe("13/11/2026 01:30");
  });
  it("chưa ký thì để trống", () => {
    expect(vnDateTime(null)).toBe("");
  });
});

import { stepOf } from "./forms";
describe("stepOf (khối duyệt lần lượt gộp vào một ô ký)", () => {
  const base = { role: "leader" as const, targetDate: "2026-11-13" };
  it("gộp tên những người đã ký, giờ của người ký sau cùng", () => {
    const merged = stepOf([
      { ...base, result: "signed", signerName: "A", actedAt: "2026-11-12T01:00:00Z" },
      { ...base, result: "signed", signerName: "B", actedAt: "2026-11-12T03:00:00Z" },
    ], "leader");
    expect(merged).toMatchObject({ result: "signed", signerName: "A, B", actedAt: "2026-11-12T03:00:00Z" });
  });
  it("chưa ai ký thì là bước đang chờ", () => {
    expect(stepOf([{ ...base, result: "pending", signerName: "", actedAt: null }, { ...base, result: "pending", signerName: "", actedAt: null }], "leader")?.result).toBe("pending");
  });
});
