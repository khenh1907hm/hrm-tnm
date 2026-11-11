/**
 * Tài khoản chấm công cho công nhân: đăng nhập bằng mã nhân viên thay cho email.
 * Supabase Auth cần email, nên mã TNM001 được đổi thành email nội bộ tnm001@tnm.com.vn
 * (tên miền của công ty: không dùng tên miền người khác sở hữu, để thư "quên mật khẩu" không lọt ra ngoài).
 * Tài khoản tạo trước đây dùng đuôi cũ @nhanvien.tnm.com.vn: đăng nhập vẫn thử đuôi cũ nếu đuôi mới không được.
 */
export const WORKER_EMAIL_DOMAIN = "tnm.com.vn";
export const LEGACY_WORKER_EMAIL_DOMAIN = "nhanvien.tnm.com.vn";

const CODE = /^[A-Za-z]{2,10}\d{1,6}$/;

/** ACC-06: mã nhân viên → email đăng nhập nội bộ (chữ thường). */
export const workerEmail = (code: string, domain = WORKER_EMAIL_DOMAIN) => `${code.trim().toLowerCase()}@${domain}`;

/** ACC-06: ô đăng nhập nhận email hoặc mã nhân viên (vd TNM001, tnm001). */
export function loginEmail(input: string): string {
  const value = input.trim();
  return CODE.test(value) ? workerEmail(value) : value;
}

/** ACC-06: các email lần lượt thử khi đăng nhập (mã nhân viên: đuôi mới rồi đuôi cũ; email thật: chính nó). */
export function loginCandidates(input: string): string[] {
  const value = input.trim();
  return CODE.test(value) ? [workerEmail(value), workerEmail(value, LEGACY_WORKER_EMAIL_DOMAIN)] : [value];
}

/** Email tài khoản chấm công (đuôi mới hoặc cũ) có dạng mã nhân viên. */
export function isWorkerEmail(email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  return CODE.test(local) && (domain === WORKER_EMAIL_DOMAIN || domain === LEGACY_WORKER_EMAIL_DOMAIN);
}

/** Mật khẩu ban đầu 8 ký tự dễ đọc (bỏ 0/O, 1/l/I). */
export function initialPassword(random: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
}
