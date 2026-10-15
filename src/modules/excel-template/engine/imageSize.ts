export type ImageExtension = "png" | "jpeg";
export type ImageInfo = { extension: ImageExtension; width: number; height: number };

/** Đọc kích thước ảnh PNG/JPEG từ phần đầu tệp, không cần giải mã ảnh. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return { extension: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    const length = view.getUint16(offset + 2);
    // SOF0–SOF15 (trừ DHT, JPG, DAC) chứa kích thước ảnh
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { extension: "jpeg", width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}
