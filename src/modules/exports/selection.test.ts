import { describe, expect, it } from "vitest";
import { buildCertificateScanSelection } from "./workerProfile";
import type { Certificate } from "../certificates/types";

const makeCertificate = (id: string, type: string, documentId: string): Certificate => ({
  id, employeeId: "worker", type, title: "", number: id, expiryDate: "2027-01-01", issueDate: null,
  document: { id: documentId, name: `${documentId}.pdf`, mime: "application/pdf", size: 10 }, supplementaryFiles: [],
  state: "current", version: 1, replacedBy: null, archiveReason: null,
});

describe("worker profile selection", () => {
  it("uses defaults when no explicit selection was supplied", () => {
    expect(buildCertificateScanSelection([makeCertificate("safe", "atld", "file-safe")], ["atld"], "2026-10-12").map((file) => file.id)).toEqual(["file-safe"]);
  });

  it("allows an explicit empty selection to untick every system category", () => {
    expect(buildCertificateScanSelection([makeCertificate("safe", "atld", "file-safe")], ["atld"], "2026-10-12", { selectedCertificateIds: [] })).toEqual([]);
  });
});
