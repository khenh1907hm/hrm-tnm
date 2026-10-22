import { useEffect, useState } from "react";
import { randomIds } from "../../lib/ids";
import type { FileRef } from "../../modules/certificates/types";
import { isLegacyPhoto, photoRef } from "../../modules/employees/photo";
import type { Employee } from "../../modules/employees/types";

/** Cạnh dài tối đa của ảnh chân dung khi lưu: in 3×4 cm ở 300 dpi chỉ cần ~470 px. */
const MAX_PHOTO_SIDE = 1200;

/** Giải mã data URL thành tệp (đồng bộ, dùng cho ảnh kiểu cũ trong bản ghi). */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const [header = "", body = ""] = dataUrl.split(",", 2);
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const binary = header.includes(";base64") ? atob(body) : decodeURIComponent(body);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], name, { type: mime });
}

/** Thu nhỏ ảnh quá lớn thành JPEG để kho lưu trữ và lượt tải nhẹ hơn; ảnh vừa cỡ giữ nguyên. */
export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1 && file.size <= 1024 * 1024) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
  canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return file; }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

export function newPhotoRef(file: File): FileRef {
  return { id: randomIds().next(), name: file.name, mime: file.type, size: file.size };
}

/** Tệp ảnh chân dung của nhân sự trong bộ tệp phiên (ảnh kiểu cũ thì giải mã từ bản ghi). */
export function photoFile(photo: Employee["photo"], sessionFiles: Readonly<Record<string, File>>): File | null {
  if (isLegacyPhoto(photo)) return dataUrlToFile(photo, "anh-3x4");
  const ref = photoRef(photo);
  return ref ? sessionFiles[ref.id] ?? null : null;
}

/**
 * Địa chỉ hiển thị ảnh chân dung: ảnh kiểu cũ dùng thẳng data URL, ảnh trong kho thì tải theo yêu cầu
 * (qua `load`) rồi tạo object URL, tự thu hồi khi đổi ảnh hoặc rời màn hình.
 */
export function usePhotoUrl(photo: Employee["photo"], load: (ref: FileRef) => Promise<File | null>): string | null {
  const ref = photoRef(photo);
  const refId = ref?.id ?? null;
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!ref) return;
    let current = true;
    let url: string | null = null;
    void load(ref).then((file) => {
      if (!current || !file) return;
      url = URL.createObjectURL(file);
      setLoaded({ id: ref.id, url });
    });
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
    // Chỉ tải lại khi đổi sang tệp ảnh khác
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId]);
  if (isLegacyPhoto(photo)) return photo;
  return ref && loaded?.id === ref.id ? loaded.url : null;
}
