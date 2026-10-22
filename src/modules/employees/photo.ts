import type { FileRef } from "../certificates/types";
import type { Employee } from "./types";

export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Bằng giới hạn của bucket `hr-files`. */
export const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

/** Ảnh kiểu cũ: chuỗi data URL nằm ngay trong bản ghi (chờ chuyển sang kho lưu trữ). */
export function isLegacyPhoto(photo: Employee["photo"]): photo is string {
  return typeof photo === "string" && photo.startsWith("data:");
}

/** Tham chiếu tệp ảnh chân dung trong kho lưu trữ, null khi chưa có ảnh hoặc ảnh kiểu cũ. */
export function photoRef(photo: Employee["photo"]): FileRef | null {
  return photo && typeof photo === "object" ? photo : null;
}
