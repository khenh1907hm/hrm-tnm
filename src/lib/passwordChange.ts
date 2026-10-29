import { MIN_PASSWORD_LENGTH } from "./accountAdmin";

export type PasswordChangeInput = { current: string; next: string; confirm: string };

/** Lỗi đầu tiên của form đổi mật khẩu, hoặc null nếu hợp lệ. */
export function passwordChangeError(input: PasswordChangeInput): string | null {
  if (!input.current) return "Nhập mật khẩu hiện tại.";
  if (input.next.length < MIN_PASSWORD_LENGTH) return `Mật khẩu mới tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.`;
  if (input.next === input.current) return "Mật khẩu mới phải khác mật khẩu hiện tại.";
  if (input.next !== input.confirm) return "Hai lần nhập mật khẩu mới không khớp.";
  return null;
}

type AuthClient = {
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ error: { message: string } | null }>;
  updateUser: (attributes: { password: string }) => Promise<{ error: { message: string } | null }>;
};

/** Kiểm tra mật khẩu hiện tại bằng cách đăng nhập lại, rồi đặt mật khẩu mới. Trả lỗi tiếng Việt hoặc null. */
export async function changeOwnPassword(auth: AuthClient, email: string, input: PasswordChangeInput): Promise<string | null> {
  const invalid = passwordChangeError(input);
  if (invalid) return invalid;
  const verified = await auth.signInWithPassword({ email, password: input.current });
  if (verified.error) return "Mật khẩu hiện tại không đúng.";
  const updated = await auth.updateUser({ password: input.next });
  if (updated.error) return /different|same/i.test(updated.error.message) ? "Mật khẩu mới phải khác mật khẩu hiện tại." : "Không đổi được mật khẩu. Thử lại sau.";
  return null;
}
