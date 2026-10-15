export type ToastVariant = "success" | "info" | "warning" | "error";

const ERROR_HINTS = /(không thể|không đọc|không tạo|không tìm|lỗi|không hợp lệ|thất bại|bị từ chối)/i;
const WARNING_HINTS = /(thiếu|chưa có|không có dữ liệu|chưa hỗ trợ|đã bỏ qua|cần kiểm tra|còn \d+ mục|hết hạn|đã hủy)/i;

/** Đoán loại thông báo khi nơi gọi không chỉ rõ. */
export function inferToastVariant(message: string): ToastVariant {
  const text = message.trim();
  if (ERROR_HINTS.test(text)) return "error";
  if (WARNING_HINTS.test(text)) return "warning";
  if (/^đã\s/i.test(text)) return "success";
  return "info";
}

/** Thời gian hiển thị: ~4,5 giây, thông báo dài được thêm thời gian để đọc, tối đa 10 giây. */
export function toastDuration(message: string): number {
  return Math.min(10_000, 4_500 + Math.max(0, message.length - 60) * 40);
}
