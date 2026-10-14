import { createWorker } from "tesseract.js";

export type OcrProgress = { index: number; total: number; progress: number; status: string };
export type OcrReadResult = { texts: string[]; cancelled: boolean };

function prepareImage(file: File): Promise<HTMLCanvasElement> {
  return createImageBitmap(file).then((bitmap) => {
    const scale = bitmap.width < 1400 ? 1400 / bitmap.width : bitmap.width > 2400 ? 2400 / bitmap.width : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) { bitmap.close(); throw new Error("Không thể tiền xử lý ảnh."); }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const red = image.data[index] ?? 0;
      const green = image.data[index + 1] ?? 0;
      const blue = image.data[index + 2] ?? 0;
      const gray = (0.299 * red + 0.587 * green + 0.114 * blue - 128) * 1.45 + 128;
      const channel = Math.max(0, Math.min(255, Math.round(gray)));
      image.data[index] = channel; image.data[index + 1] = channel; image.data[index + 2] = channel;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  });
}

export async function readIdImages(
  files: readonly File[],
  signal: AbortSignal,
  progress: (value: OcrProgress) => void,
): Promise<OcrReadResult> {
  let index = 0;
  const worker = await createWorker("vie+eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core/",
    langPath: "/tessdata",
    workerBlobURL: false,
    gzip: false,
    cacheMethod: "none",
    logger: (message) => progress({ index, total: files.length, progress: message.progress, status: message.status }),
  });
  const abortWorker = () => { void worker.terminate(); };
  signal.addEventListener("abort", abortWorker, { once: true });
  const texts: string[] = [];
  try {
    for (index = 0; index < files.length; index += 1) {
      if (signal.aborted) return { texts, cancelled: true };
      const file = files[index];
      if (!file) continue;
      const canvas = await prepareImage(file);
      try {
        const result = await worker.recognize(canvas);
        if (signal.aborted) return { texts, cancelled: true };
        texts.push(result.data.text);
        progress({ index, total: files.length, progress: 1, status: "Đã đọc xong ảnh" });
      } finally { canvas.width = 0; canvas.height = 0; }
    }
    return { texts, cancelled: false };
  } finally {
    signal.removeEventListener("abort", abortWorker);
    if (!signal.aborted) await worker.terminate();
  }
}
