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
