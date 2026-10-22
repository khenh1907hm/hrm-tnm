/**
 * Xoay ảnh 90° theo chiều kim đồng hồ (xử lý trong trình duyệt, đã áp cờ xoay EXIF của điện thoại).
 * `onlyIfPortrait`: chỉ xoay khi ảnh đang dọc, dùng để đưa ảnh CCCD về nằm ngang.
 */
export async function rotateImageFile(file: File, onlyIfPortrait = false): Promise<File> {
  const bitmap = await createImageBitmap(file);
  if (onlyIfPortrait && bitmap.height <= bitmap.width) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height; canvas.height = bitmap.width;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Trình duyệt không xử lý được ảnh."); }
  context.translate(canvas.width, 0); context.rotate(Math.PI / 2);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không xoay được ảnh.")), type, 0.92));
  return new File([blob], file.name.replace(/\.[^.]+$/, type === "image/png" ? ".png" : ".jpg"), { type });
}
