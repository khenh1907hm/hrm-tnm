import { removeWhiteBackground } from "./removeWhiteBackground";

/** Ảnh chụp chữ ký trên giấy trắng → PNG nền trong suốt (xử lý ngay trong trình duyệt). Có maxWidth thì thu nhỏ cho nhẹ. */
export async function toTransparentPng(upload: File, maxWidth?: number): Promise<File> {
  const bitmap = await createImageBitmap(upload);
  const scale = maxWidth && bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể xử lý ảnh chữ ký.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(removeWhiteBackground({ data: pixels.data, width: pixels.width, height: pixels.height }).data);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh chữ ký PNG.")), "image/png"));
  return new File([blob], `${upload.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
}
