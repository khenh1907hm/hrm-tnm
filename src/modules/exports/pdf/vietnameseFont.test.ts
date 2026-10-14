import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildWorkerProfileData } from "../workerProfile";
import { renderWorkerProfilePdf } from "./renderWorkerProfilePdf";
import type { Employee } from "../../employees/types";
import type { Signature } from "../../signatures/types";

const fontPath = (name: string) => join(process.cwd(), "public", "fonts", name);
const regular = new Uint8Array(readFileSync(fontPath("BeVietnamPro-Regular.ttf")));
const bold = new Uint8Array(readFileSync(fontPath("BeVietnamPro-Bold.ttf")));

// Mọi nguyên âm tiếng Việt kết hợp với năm dấu thanh, cả chữ hoa lẫn chữ thường, cùng đ/Đ.
const VOWELS = ["a", "ă", "â", "e", "ê", "i", "o", "ô", "ơ", "u", "ư", "y"];
const TONES = ["", "\u0300", "\u0301", "\u0303", "\u0309", "\u0323"];
const VIETNAMESE_LETTERS = [...VOWELS.flatMap((vowel) => TONES.map((tone) => (vowel + tone).normalize("NFC"))), "đ"].flatMap((letter) => [letter, letter.toLocaleUpperCase("vi")]);

describe("Be Vietnam Pro fonts used by the PDF export", () => {
  it.each([["Regular", regular], ["Bold", bold]])("%s has a real glyph for every Vietnamese letter", (_, bytes) => {
    const font = fontkit.create(Buffer.from(bytes));
    const missing = VIETNAMESE_LETTERS.filter((letter) => font.glyphForCodePoint(letter.codePointAt(0) ?? 0).id === 0);
    expect(VIETNAMESE_LETTERS).toHaveLength(146);
    expect(missing).toEqual([]);
  });

  it("renders a cover page with Vietnamese text using the real fonts", async () => {
    const employee: Employee = { id: "worker-1", code: "TNM100", name: "Nguyễn Thị Phượng Hằng", dob: "1990-01-01", gender: "Nữ", cccd: "001190123456", phone: "0912345678", home: "Xã Hoằng Phú, Tỉnh Thanh Hóa", address: "Thôn Ka Đê, Xã Quảng Lập, Tỉnh Lâm Đồng", position: "Nhân viên hiện trường", group: 3, startDate: "2020-01-01", emergencyContactId: null, status: "active", endDate: null, archivedAt: null, archivedBy: null, archiveReason: null, cccdMismatchOverrideReason: null, version: 1 };
    const signer: Signature = { id: "signer-1", name: "Trần Đức Mạnh", role: "Giám đốc", isDefault: true, version: 1, file: { id: "signature-file", name: "sign.png", mime: "image/png", size: 10, hasTransparency: true } };
    const bytes = await renderWorkerProfilePdf(buildWorkerProfileData(employee, [], signer, "2026-10-12"), new Map(), { regular, bold });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    if (process.env.PDF_PREVIEW_OUT) writeFileSync(process.env.PDF_PREVIEW_OUT, bytes);
  });
});
