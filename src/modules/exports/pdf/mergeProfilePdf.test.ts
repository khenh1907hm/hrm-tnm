import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { mergeProfilePdf } from "./mergeProfilePdf";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array) => {
  const body = new Uint8Array([...Buffer.from(type, "ascii"), ...data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); Buffer.from(body).copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
/** PNG xám tối thiểu kích thước width×height. */
function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
}
const JPEG_1X2 = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));

async function pdf(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([300, 400]);
  return document.save();
}

describe("mergeProfilePdf", () => {
  it("merges only the certificates when there is no cover page", async () => {
    const result = await mergeProfilePdf(null, [{ title: "ATLĐ", kind: "pdf", bytes: await pdf(2) }, { title: "Sức khỏe", kind: "image", bytes: png(40, 20), extension: "png" }]);
    expect(result.warnings).toEqual([]);
    expect(result.pageCount).toBe(3);
    expect((await PDFDocument.load(result.bytes)).getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  });

  it("appends certificate PDFs and scans after the cover in order", async () => {
    const result = await mergeProfilePdf(await pdf(1), [
      { title: "ATLĐ", kind: "pdf", bytes: await pdf(2) },
      { title: "Sức khỏe", kind: "image", bytes: png(40, 20), extension: "png" },
      { title: "Điện", kind: "image", bytes: JPEG_1X2, extension: "jpeg" },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.pageCount).toBe(5);
    const merged = await PDFDocument.load(result.bytes);
    const sizes = merged.getPages().map((page) => page.getSize());
    expect(sizes[0]).toEqual({ width: 300, height: 400 });
    expect(sizes[3]!.width).toBeGreaterThan(sizes[3]!.height); // ảnh ngang → trang A4 ngang
    expect(sizes[4]!.height).toBeGreaterThan(sizes[4]!.width);
  });

  it("skips broken files with a warning and keeps the rest", async () => {
    const result = await mergeProfilePdf(await pdf(1), [
      { title: "Hỏng", kind: "pdf", bytes: new Uint8Array([1, 2, 3]) },
      { title: "Ảnh hỏng", kind: "image", bytes: new Uint8Array([1, 2]), extension: "png" },
    ]);
    expect(result.pageCount).toBe(1);
    expect(result.warnings).toEqual(["Hỏng: tệp bị hỏng hoặc không đọc được, đã bỏ qua", "Ảnh hỏng: tệp bị hỏng hoặc không đọc được, đã bỏ qua"]);
  });
});
