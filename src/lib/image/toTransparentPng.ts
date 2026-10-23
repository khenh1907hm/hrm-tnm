import { findContentBounds, removeWhiteBackground } from "./removeWhiteBackground";

/** Cạnh dài tối đa khi tách nền: ảnh điện thoại 12 MP thu về cỡ này vẫn đủ nét cho chữ ký, mộc mà xử lý nhanh. */
const PROCESS_MAX_SIDE = 2400;

/**
 * Ảnh chụp chữ ký / mộc trên giấy → PNG nền trong suốt, cắt sát phần có mực (xử lý ngay trong trình duyệt).
 * Có maxWidth thì thu nhỏ ảnh kết quả cho nhẹ. `force`: tách lại cả ảnh đã trong suốt (nút "Xóa nền").
 */
export async function toTransparentPng(upload: File, maxWidth?: number, options: { force?: boolean } = {}): Promise<File> {
  const bitmap = await createImageBitmap(upload);
  const scale = Math.min(1, PROCESS_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể xử lý ảnh chữ ký.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const cleaned = removeWhiteBackground({ data: pixels.data, width: pixels.width, height: pixels.height }, options);
  pixels.data.set(cleaned.data);
  context.putImageData(pixels, 0, 0);

  const bounds = findContentBounds(cleaned) ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const outputScale = maxWidth && bounds.width > maxWidth ? maxWidth / bounds.width : 1;
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(bounds.width * outputScale)); output.height = Math.max(1, Math.round(bounds.height * outputScale));
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Không thể xử lý ảnh chữ ký.");
  outputContext.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, output.width, output.height);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh chữ ký PNG.")), "image/png"));
  return new File([blob], `${upload.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
}
