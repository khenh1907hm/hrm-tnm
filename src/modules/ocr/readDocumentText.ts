import { createWorker, PSM, type Worker } from "tesseract.js";

/** Số trang PDF đọc tối đa: thông tin chứng chỉ nằm ở 1–2 trang đầu (hợp đồng bảo hiểm có hạn ở trang 2). */
const MAX_PDF_PAGES = 3;
/** Ảnh scan chứng chỉ thường chỉ ~100 dpi: phóng lên ~2400px chiều ngang để Tesseract đọc rõ chữ nhỏ. */
const TARGET_WIDTH = 2400;

export type DocumentReadProgress = { page: number; pages: number; progress: number };

/** Xám hóa + tăng tương phản (như ảnh CCCD) để chữ in trên nền hoa văn, dấu đỏ dễ đọc hơn. */
function enhance(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = (0.299 * (image.data[index] ?? 0) + 0.587 * (image.data[index + 1] ?? 0) + 0.114 * (image.data[index + 2] ?? 0) - 128) * 1.45 + 128;
    const channel = Math.max(0, Math.min(255, Math.round(gray)));
    image.data[index] = channel; image.data[index + 1] = channel; image.data[index + 2] = channel;
  }
  context.putImageData(image, 0, 0);
}

async function imageToCanvases(file: Blob): Promise<HTMLCanvasElement[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(3, Math.max(1, TARGET_WIDTH / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return [canvas];
}

/** Vẽ các trang đầu của PDF ra ảnh, đúng chiều xoay của trang (ảnh scan trong PDF hay lưu nằm ngang rồi xoay khi hiển thị). */
async function pdfToCanvases(file: Blob): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const canvases: HTMLCanvasElement[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number += 1) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, TARGET_WIDTH / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      // intent "print": vẽ liền một lượt, không chờ requestAnimationFrame (bị dừng khi người dùng chuyển sang tab khác)
      await page.render({ canvas, viewport, intent: "print" }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await task.destroy();
  }
}

function crop(source: HTMLCanvasElement, x: number, y: number, width: number, height: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context) { context.imageSmoothingQuality = "high"; context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height); }
  return canvas;
}

/**
 * Cắt một vùng rồi làm rõ chữ: "gray" xám hóa thường; "ink" lấy kênh tối nhất của xanh lá/xanh dương để chữ mực đỏ
 * (số viết, dấu đỏ đè lên) cũng đậm như mực đen.
 */
function inkCrop(source: HTMLCanvasElement, box: Box, scale: number, mode: "gray" | "ink"): HTMLCanvasElement {
  const canvas = crop(source, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index] ?? 0, green = image.data[index + 1] ?? 0, blue = image.data[index + 2] ?? 0;
    const base = mode === "ink" ? Math.min(green, blue) : 0.299 * red + 0.587 * green + 0.114 * blue;
    const channel = Math.max(0, Math.min(255, Math.round((base - 128) * 1.5 + 128)));
    image.data[index] = channel; image.data[index + 1] = channel; image.data[index + 2] = channel;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Bộ ký tự khi đọc lại dòng số chứng chỉ: chữ in hoa, số, dấu ngăn cách. */
const NUMBER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZĐ/-. :";
/** Dòng có số chứng chỉ: "Số: …", "Số 24F…" (không dấu hai chấm), "…/TATLĐ", "…/N1/…", "…/GKSK", "…/TTS/…". */
const NUMBER_LINE = /(^|[^a-z])s[o0]\s*[:.]?\s*[a-z]?[\s-]*\d|\/\s*tat|\/\s*n\d\s*\/|gksk|tts\//;
/** Dòng số quyết định, số "căn cứ" văn bản: không phải số chứng chỉ, không đọc lại. */
const NOT_CERTIFICATE_NUMBER = /\/\s*q[dđ]|can cu|nghi dinh|thong tu|giay chung nhan so/;
/** Dòng ghi đúng dạng số chứng chỉ đọc lại trước (giới hạn 6 dòng mỗi trang). */
const CERTIFICATE_NUMBER_SHAPE = /\/\s*tat|\/\s*n\d\s*\/|gksk|tts\/|[a-z]-\d{2}\//;
const plainText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();

/**
 * Đọc lại riêng từng dòng có số chứng chỉ (cắt sát dòng, phóng to, chỉ cho phép chữ in hoa/số/dấu ngăn cách),
 * 4 cách: xám và kênh mực, phóng 2 lần và 3 lần. Mỗi lần đọc thành một dòng "#doclai so: …" để bộ phân tích bỏ phiếu:
 * chỉ điền số khi ít nhất 2 lần đọc khớp nhau.
 */
async function rereadNumberLines(worker: Worker, source: HTMLCanvasElement, lines: { text: string; bbox: Box }[]): Promise<string[]> {
  const targets = lines
    .filter((line) => NUMBER_LINE.test(plainText(line.text)) && !NOT_CERTIFICATE_NUMBER.test(plainText(line.text)))
    .sort((a, b) => Number(CERTIFICATE_NUMBER_SHAPE.test(plainText(b.text))) - Number(CERTIFICATE_NUMBER_SHAPE.test(plainText(a.text))))
    .slice(0, 6);
  if (!targets.length) return [];
  const reads: string[] = [];
  try {
    await worker.setParameters({ tessedit_char_whitelist: NUMBER_CHARS, tessedit_pageseg_mode: PSM.SINGLE_LINE });
    for (const line of targets) {
      const height = line.bbox.y1 - line.bbox.y0;
      const box = { x0: Math.max(0, line.bbox.x0 - height), y0: Math.max(0, line.bbox.y0 - height * 0.25), x1: Math.min(source.width, line.bbox.x1 + height), y1: Math.min(source.height, line.bbox.y1 + height * 0.25) };
      for (const mode of ["gray", "ink"] as const) for (const scale of [2, 3]) {
        // Bỏ tiền tố "S:", "SO:", "SỐ" (OCR hay đọc "Số" thành "S") để mọi lần đọc có cùng dạng "#doclai so: <số>"
        const text = (await worker.recognize(inkCrop(source, box, scale, mode))).data.text.trim().replace(/^[^A-Z0-9]*S[O0Ố]?\s*[:.]?\s*/i, "");
        if (text) reads.push(`#doclai so: ${text}`);
      }
    }
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PSM.AUTO });
  }
  return reads;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
/** Dòng 1 và dòng 2 của mã MRZ mặt sau CCCD. */
const MRZ_FIRST = /[I1lL|]DVNM/;
const MRZ_SECOND = /\d{6,7}[MF<]\d{6,7}VNM/i;
const linesOf = (data: { blocks: { paragraphs: { lines: { text: string; bbox: Box; words: { text: string; bbox: Box }[] }[] }[] }[] | null }) =>
  (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));

/**
 * Ngày cấp CCCD gắn chip nằm ở mặt sau, phía trên ("Ngày, tháng, năm / Date, month, year: 04/10/2022"), chữ rất nhỏ nên lượt
 * đọc cả trang hay bỏ sót. Định vị mặt sau theo dòng MRZ "IDVNM…" (đáy mặt sau, rộng ~90% thẻ, thẻ tỉ lệ 85,6×54 mm),
 * đọc lại vùng phía trên để tìm dòng nhãn, rồi đọc riêng phần ngày bên phải nhãn chỉ với chữ số và "/".
 * Trả về dòng "Date, month, year: …" để bộ phân tích xử lý như chữ thường (kèm kiểm tra ngày hợp lý).
 */
async function readCccdIssueLine(worker: Worker, canvas: HTMLCanvasElement, words: { text: string; bbox: Box }[]): Promise<string | null> {
  // Khối MRZ 3 dòng: dòng 1 "IDVNM…" (OCR hay đọc "1DVNM", có khi cắt cụt), dòng 2 "YYMMDD…VNM<<<", dòng 3 tên "HO<<TEN<<<".
  // Lấy mép trái/phải của cả khối cho chắc; thiếu dòng 1 thì lùi lên một dòng từ dòng 2.
  const first = words.find((word) => MRZ_FIRST.test(word.text));
  const second = words.find((word) => MRZ_SECOND.test(word.text));
  const anchor = first ?? second;
  if (!anchor) return null;
  const lineHeight = anchor.bbox.y1 - anchor.bbox.y0;
  const block = words.filter((word) => word.text.length >= 8 && (MRZ_FIRST.test(word.text) || MRZ_SECOND.test(word.text) || /<<.*<</.test(word.text)) && word.bbox.y0 >= anchor.bbox.y0 - lineHeight * 2 && word.bbox.y0 <= anchor.bbox.y0 + lineHeight * 5);
  const mrzLeft = Math.min(...block.map((word) => word.bbox.x0));
  const mrzRight = Math.max(...block.map((word) => word.bbox.x1));
  const cardWidth = (mrzRight - mrzLeft) / 0.9;
  const cardHeight = (cardWidth * 54) / 85.6;
  const lineTop = first ? first.bbox.y0 : anchor.bbox.y0 - lineHeight * 1.3;
  const left = Math.max(0, mrzLeft - cardWidth * 0.05);
  const top = Math.max(0, lineTop - cardHeight * 0.68);
  const areaScale = 2;
  const area = crop(canvas, left, top + cardHeight * 0.12, cardWidth * 0.62, cardHeight * 0.22, areaScale);
  const label = linesOf((await worker.recognize(area, {}, { blocks: true })).data).find((line) => /ng[aà]y|th[aá]ng|year/i.test(line.text));
  if (!label) return null;
  const width = label.bbox.x1 - label.bbox.x0, height = label.bbox.y1 - label.bbox.y0;
  try {
    await worker.setParameters({ tessedit_char_whitelist: "0123456789/", tessedit_pageseg_mode: PSM.SINGLE_LINE });
    // Nhiều lần đọc (vị trí cắt, độ phóng, ảnh gốc / kênh mực): bộ phân tích chỉ nhận ngày khi ít nhất 2 lần đọc khớp nhau
    const reads: string[] = [];
    for (const from of [0.62, 0.65]) for (const scale of [3, 4]) {
      const dateArea = crop(canvas, left + (label.bbox.x0 + width * from) / areaScale, top + cardHeight * 0.12 + (label.bbox.y0 - height * 0.15) / areaScale, (width * (1 - from) + height) / areaScale, (height * 1.3) / areaScale, scale);
      for (const variant of [dateArea, inkCrop(dateArea, { x0: 0, y0: 0, x1: dateArea.width, y1: dateArea.height }, 1, "ink")]) {
        const digits = (await worker.recognize(variant)).data.text.trim();
        if (digits) reads.push(`Date, month, year: ${digits}`);
      }
    }
    return reads.length ? reads.join("\n") : null;
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PSM.AUTO });
  }
}

/**
 * Đọc chữ trong tệp chứng chỉ (PDF scan hoặc ảnh chụp) bằng Tesseract, ngay trên trình duyệt; tệp không gửi đi đâu.
 * Trả về chữ của từng trang, nối bằng dòng trống.
 */
export async function readDocumentText(file: Blob, signal?: AbortSignal, progress?: (value: DocumentReadProgress) => void): Promise<string> {
  const canvases = file.type === "application/pdf" ? await pdfToCanvases(file) : await imageToCanvases(file);
  let page = 0;
  const worker = await createWorker("vie+eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core/",
    langPath: "/tessdata",
    workerBlobURL: false,
    gzip: false,
    cacheMethod: "none",
    logger: (message) => { if (message.status === "recognizing text") progress?.({ page, pages: canvases.length, progress: message.progress }); },
  });
  const stop = () => { void worker.terminate(); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const texts: string[] = [];
    for (page = 0; page < canvases.length; page += 1) {
      if (signal?.aborted) break;
      const canvas = canvases[page]!;
      // Giữ bản chưa tăng tương phản cho lượt đọc lại vùng nhỏ (ngày cấp CCCD): chữ nhỏ bị tương phản làm mất nét
      const original = crop(canvas, 0, 0, canvas.width, canvas.height, 1);
      enhance(canvas);
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      texts.push(data.text);
      // CCCD: đọc thêm vùng ngày cấp ở mặt sau nếu lượt đầu chưa thấy
      if ((MRZ_FIRST.test(data.text) || MRZ_SECOND.test(data.text)) && !/(date|year)[^\n]{0,10}\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}/i.test(data.text)) {
        const issueLine = await readCccdIssueLine(worker, original, linesOf(data).flatMap((line) => line.words)).catch(() => null);
        if (issueLine) texts.push(issueLine);
      }
      texts.push(...await rereadNumberLines(worker, original, linesOf(data)).catch(() => []));
      original.width = 0; original.height = 0;
      canvas.width = 0; canvas.height = 0;
    }
    return texts.join("\n\n");
  } finally {
    signal?.removeEventListener("abort", stop);
    if (!signal?.aborted) await worker.terminate();
  }
}
