import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorkerProfileData } from "../workerProfile";
import { renderWorkerProfilePdf } from "./renderWorkerProfilePdf";
import type { Employee } from "../../employees/types";
import type { Signature } from "../../signatures/types";

const fakeState = vi.hoisted(() => ({ pages: 0 }));
vi.mock("@pdf-lib/fontkit", () => ({ default: {} }));
vi.mock("pdf-lib", () => {
  const font = { widthOfTextAtSize: (text: string, size: number) => text.length * size / 2 };
  const page = { drawText: () => undefined, drawRectangle: () => undefined, drawLine: () => undefined, drawImage: () => undefined };
  return { rgb: () => ({}), PDFDocument: { create: async () => ({ registerFontkit: () => undefined, embedFont: async () => font, embedPng: async () => ({ width: 100, height: 80 }), embedJpg: async () => ({ width: 100, height: 80 }), addPage: () => { fakeState.pages += 1; return page; }, save: async () => new Uint8Array([1]) }) } };
});

const employee: Employee = { id: "worker-1", code: "TNM100", name: "Nguyễn Minh An", dob: "1990-01-01", gender: "Nam", cccd: "001090123456", phone: "0912345678", home: "Hà Nội", address: "Hà Nội", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-01", emergencyContactId: "cmd-1", status: "active", endDate: null, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, version: 1 };
const signer: Signature = { id: "signer-1", name: "Nguyễn Minh An", role: "Giám đốc", isDefault: true, version: 1, file: { id: "signature-file", name: "sign.png", mime: "image/png", size: 10, hasTransparency: true } };

describe("renderWorkerProfilePdf", () => {
  beforeEach(() => { fakeState.pages = 0; });

  it("creates one cover page followed by the expected scan pages", async () => {
    const data = buildWorkerProfileData(employee, [], signer, "2026-10-12");
    const first = { id: "scan-1", name: "one.png", mime: "image/png", size: 10 };
    const second = { id: "scan-2", name: "two.png", mime: "image/png", size: 10 };
    data.scans.push(first, second);
    const bytes = await renderWorkerProfilePdf(data, new Map([[first.id, { bytes: new Uint8Array([1]), mime: "image/png" }], [second.id, { bytes: new Uint8Array([1]), mime: "image/png" }]]), { regular: new Uint8Array([1]), bold: new Uint8Array([1]) });
    expect(bytes.length).toBeGreaterThan(0);
    expect(fakeState.pages).toBe(3);
  });

  it("reports a clear error when either required font is missing", async () => {
    const data = buildWorkerProfileData(employee, [], signer, "2026-10-12");
    await expect(renderWorkerProfilePdf(data, new Map(), { regular: null, bold: null })).rejects.toThrow("Thiếu phông Be Vietnam Pro");
  });
});
