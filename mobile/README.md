# App điện thoại TNM (Expo / React Native)

Một bộ code cho iOS và Android. Dùng chung Supabase (đăng nhập + dữ liệu) với bản web, gọi API trên VPS `tnm.com.vn` bằng token đăng nhập.

## Chạy thử

```powershell
cd mobile
npm install
copy .env.example .env.local   # rồi điền EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx expo start
```

- Điện thoại: cài app **Expo Go** (App Store / CH Play), cùng mạng Wi-Fi với máy tính, quét mã QR hiện trong terminal.
- Trình duyệt: nhấn `w` trong terminal (hoặc `npm run web`).

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/app/` | Màn hình (Expo Router): `login`, `pending` (chờ cấp quyền), `index` (trang chủ) |
| `src/lib/supabase.ts` | Kết nối Supabase, lưu phiên trên máy |
| `src/lib/auth.tsx` | Đăng nhập / đăng xuất, vai trò, `apiFetch` gọi API VPS |
| `src/lib/singleSession.ts` | Một tài khoản một nơi (chung cơ chế với web: đăng nhập app sẽ đăng xuất web và ngược lại) |
| `src/lib/workerLogin.ts` | Đăng nhập bằng mã nhân viên (chép từ web, sửa thì sửa cả hai nơi) |

## Kiểm tra

```powershell
npm run typecheck
npx expo-doctor
```
