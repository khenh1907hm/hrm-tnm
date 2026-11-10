/**
 * Tài khoản chấm công cho công nhân: đăng nhập bằng mã nhân viên thay cho email.
 * Supabase Auth cần email, nên mã TNM001 được đổi thành email nội bộ tnm001@nhanvien.tnm.com.vn
 * (tên miền con không có hộp thư; tài khoản tạo sẵn đã xác nhận nên không gửi thư nào).
 */
export const WORKER_EMAIL_DOMAIN = "nhanvien.tnm.com.vn";

/** ACC-06: mã nhân viên → email đăng nhập nội bộ (chữ thường). */
export const workerEmail = (code: string) => `${code.trim().toLowerCase()}@${WORKER_EMAIL_DOMAIN}`;

/** ACC-06: ô đăng nhập nhận email hoặc mã nhân viên (vd TNM001, tnm001). */
export function loginEmail(input: string): string {
  const value = input.trim();
  return /^[A-Za-z]{2,10}\d{1,6}$/.test(value) ? workerEmail(value) : value;
}

export const isWorkerEmail = (email: string) => email.toLowerCase().endsWith(`@${WORKER_EMAIL_DOMAIN}`);

/** Mật khẩu ban đầu 8 ký tự dễ đọc (bỏ 0/O, 1/l/I). */
export function initialPassword(random: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
}
