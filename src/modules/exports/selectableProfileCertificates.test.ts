import { describe, expect, it } from "vitest";
import { getSelectableProfileCertificates } from "./workerProfile";
import { SYSTEM_CERTIFICATE_TYPES } from "../certificate-types/types";
import type { Certificate } from "../certificates/types";

const make = (id: string, type: string, expiryDate: string, state: Certificate["state"] = "current"): Certificate => ({ id, employeeId: "worker", type, title: "", number: id, issueDate: null, expiryDate, document: { id: `file-${id}`, name: `${id}.pdf`, mime: "application/pdf", size: 1 }, supplementaryFiles: [], state, version: 1, replacedBy: null, archiveReason: null });

describe("getSelectableProfileCertificates", () => {
  it("lists only current certificates valid on the signing date", () => {
    const choices = getSelectableProfileCertificates("worker", "2026-10-12", [make("valid", "atld", "2027-01-01"), make("expired", "atld", "2026-10-01"), make("replaced", "atld", "2028-01-01", "replaced")], SYSTEM_CERTIFICATE_TYPES);
    expect(choices.system[0]?.certificates.map((item) => item.id)).toEqual(["valid"]);
  });

  it("includes valid custom certificates as optional extras", () => {
    const custom = make("extra", "custom-one", "2027-01-01");
    const choices = getSelectableProfileCertificates("worker", "2026-10-12", [custom], SYSTEM_CERTIFICATE_TYPES);
    expect(choices.extra.map((item) => item.id)).toEqual(["extra"]);
  });
});
