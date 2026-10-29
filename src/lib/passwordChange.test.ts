import { describe, expect, it, vi } from "vitest";
import { changeOwnPassword, passwordChangeError } from "./passwordChange";

const auth = (signInError: string | null = null, updateError: string | null = null) => ({
  signInWithPassword: vi.fn(async () => ({ error: signInError ? { message: signInError } : null })),
  updateUser: vi.fn(async () => ({ error: updateError ? { message: updateError } : null })),
});

describe("đổi mật khẩu của chính mình", () => {
  it("kiểm tra form trước khi gọi máy chủ", () => {
    expect(passwordChangeError({ current: "", next: "matkhau123", confirm: "matkhau123" })).toBe("Nhập mật khẩu hiện tại.");
    expect(passwordChangeError({ current: "cu", next: "ngan", confirm: "ngan" })).toBe("Mật khẩu mới tối thiểu 8 ký tự.");
    expect(passwordChangeError({ current: "matkhau123", next: "matkhau123", confirm: "matkhau123" })).toBe("Mật khẩu mới phải khác mật khẩu hiện tại.");
    expect(passwordChangeError({ current: "cu", next: "matkhau123", confirm: "matkhau124" })).toBe("Hai lần nhập mật khẩu mới không khớp.");
    expect(passwordChangeError({ current: "cu", next: "matkhau123", confirm: "matkhau123" })).toBeNull();
  });

  it("chỉ đặt mật khẩu mới khi mật khẩu hiện tại đúng", async () => {
    const wrong = auth("Invalid login credentials");
    expect(await changeOwnPassword(wrong, "a@tnm.vn", { current: "sai", next: "matkhau123", confirm: "matkhau123" })).toBe("Mật khẩu hiện tại không đúng.");
    expect(wrong.updateUser).not.toHaveBeenCalled();

    const ok = auth();
    expect(await changeOwnPassword(ok, "a@tnm.vn", { current: "cu", next: "matkhau123", confirm: "matkhau123" })).toBeNull();
    expect(ok.signInWithPassword).toHaveBeenCalledWith({ email: "a@tnm.vn", password: "cu" });
    expect(ok.updateUser).toHaveBeenCalledWith({ password: "matkhau123" });

    expect(await changeOwnPassword(auth(null, "boom"), "a@tnm.vn", { current: "cu", next: "matkhau123", confirm: "matkhau123" })).toBe("Không đổi được mật khẩu. Thử lại sau.");
  });
});
