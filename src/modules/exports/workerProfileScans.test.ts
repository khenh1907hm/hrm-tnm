import { describe, expect, it } from "vitest";
import { buildCertificateScanSelection } from "./workerProfile";
import type { Certificate } from "../certificates/types";

const mockCert = (id: string, type: string, docId: string, suppIds: string[] = []): Certificate => ({
  id,
  employeeId: "emp-1",
  type,
  title: "",
  number: "12345",
  issueDate: "2024-01-01",
  expiryDate: "2027-01-01",
  state: "current",
  version: 1,
  document: { id: docId, name: `${docId}.pdf`, mime: "application/pdf", size: 100 },
  supplementaryFiles: suppIds.map((sid) => ({ file: { id: sid, name: `${sid}.pdf`, mime: "application/pdf", size: 50 }, label: sid })),
  replacedBy: null,
  archiveReason: null,
});

describe("buildCertificateScanSelection with granular file selection", () => {
  const cert1 = mockCert("cert-1", "atld", "doc-1", ["supp-1", "supp-2"]);

  it("selects only primary document when selectedFileIds excludes supplementary files", () => {
    const scans = buildCertificateScanSelection([cert1], ["atld"], "2026-10-14", {
      selectedCertificateIds: ["cert-1"],
      includeSupplementary: true,
      selectedFileIds: ["doc-1"],
    });
    expect(scans.map((s) => s.id)).toEqual(["doc-1"]);
  });

  it("selects only supplementary file when primary document is unselected", () => {
    const scans = buildCertificateScanSelection([cert1], ["atld"], "2026-10-14", {
      selectedCertificateIds: ["cert-1"],
      includeSupplementary: true,
      selectedFileIds: ["supp-2"],
    });
    expect(scans.map((s) => s.id)).toEqual(["supp-2"]);
  });
});
