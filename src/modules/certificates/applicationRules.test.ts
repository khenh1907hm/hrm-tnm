import { describe, expect, it } from "vitest";
import { hasValidRenewalIdentity } from "./applicationRules";

describe("certificate application rules", () => {
  it("CERT_07 accepts the same certificate type and normalized title during renewal", () => {
    expect(hasValidRenewalIdentity("atld", "Hòa Phát", "atld", "  HOA   PHAT ")).toBe(true);
  });

  it("CERT_07 rejects renewal when its type or normalized title changes", () => {
    expect(hasValidRenewalIdentity("atld", "Hòa Phát", "atld", "Hòa Phát")).toBe(true);
    expect(hasValidRenewalIdentity("atld", "Hòa Phát", "elec", "Hòa Phát")).toBe(false);
    expect(hasValidRenewalIdentity("atld", "Hòa Phát", "atld", "Other")).toBe(false);
  });
});
