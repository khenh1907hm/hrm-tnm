import { PDFDocument } from "pdf-lib";

/** Một phần ghép sau phiếu: tệp PDF chứng chỉ (giữ nguyên trang) hoặc ảnh scan (một trang A4). */
export type MergePart =
  | { title: string; kind: "pdf"; bytes: Uint8Array }
  | { title: string; kind: "image"; bytes: Uint8Array; extension: "png" | "jpeg" };

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;

/**
 * Ghép phiếu (PDF đã chuyển từ Excel) với các chứng chỉ theo thứ tự, từ trên xuống dưới.
 * Tệp hỏng/không đọc được bị bỏ qua và trả về cảnh báo, phần còn lại vẫn được ghép.
 */
export async function mergeProfilePdf(cover: Uint8Array, parts: readonly MergePart[]): Promise<{ bytes: Uint8Array; pageCount: number; warnings: string[] }> {
  const output = await PDFDocument.create();
  const coverDocument = await PDFDocument.load(cover, { ignoreEncryption: true });
  for (const page of await output.copyPages(coverDocument, coverDocument.getPageIndices())) output.addPage(page);
  const warnings: string[] = [];

  for (const part of parts) {
    try {
      if (part.kind === "pdf") {
        const source = await PDFDocument.load(part.bytes, { ignoreEncryption: true });
        for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
        continue;
      }
      const image = part.extension === "png" ? await output.embedPng(part.bytes) : await output.embedJpg(part.bytes);
      const [width, height] = image.width > image.height ? [A4[1], A4[0]] : A4;
      const scale = Math.min((width - MARGIN * 2) / image.width, (height - MARGIN * 2) / image.height);
      const drawWidth = image.width * scale, drawHeight = image.height * scale;
      output.addPage([width, height]).drawImage(image, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
    } catch {
      warnings.push(`${part.title}: tệp bị hỏng hoặc không đọc được, đã bỏ qua`);
    }
  }
  return { bytes: await output.save(), pageCount: output.getPageCount(), warnings };
}
