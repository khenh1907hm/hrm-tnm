/**
 * Chép từ web: src/lib/workerLogin.ts (ACC-06). Sửa ở web thì sửa cả ở đây.
 * Mã nhân viên TNM001 → email nội bộ tnm001@tnm.com.vn; tài khoản cũ dùng đuôi @nhanvien.tnm.com.vn.
 */
export const WORKER_EMAIL_DOMAIN = "tnm.com.vn";
export const LEGACY_WORKER_EMAIL_DOMAIN = "nhanvien.tnm.com.vn";

const CODE = /^[A-Za-z]{2,10}\d{1,6}$/;

export const workerEmail = (code: string, domain = WORKER_EMAIL_DOMAIN) => `${code.trim().toLowerCase()}@${domain}`;

/** Các email lần lượt thử khi đăng nhập (mã nhân viên: đuôi mới rồi đuôi cũ; email thật: chính nó). */
export function loginCandidates(input: string): string[] {
  const value = input.trim();
  return CODE.test(value) ? [workerEmail(value), workerEmail(value, LEGACY_WORKER_EMAIL_DOMAIN)] : [value];
}
