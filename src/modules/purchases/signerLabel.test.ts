import { describe, expect, it } from "vitest";
import { signerLabel } from "./approval";

describe("signerLabel: tên người ký in lên biểu mẫu", () => {
  it("email admin in là Admin, email khác in phần trước @", () => {
    expect(signerLabel("admin@tnm.com")).toBe("Admin");
    expect(signerLabel("ketoan@tnm.com.vn")).toBe("ketoan");
    expect(signerLabel("admin@tnm.com, kythuat@tnm.com")).toBe("Admin, kythuat");
  });
  it("họ tên giữ nguyên", () => {
    expect(signerLabel("Nguyễn Văn A")).toBe("Nguyễn Văn A");
    expect(signerLabel(null)).toBe("");
  });
});
