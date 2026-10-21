# Nhập hồ sơ từ Claude (skill /ho-so)

## Luồng dùng

1. HR mở Claude (bản Free cũng được), dùng skill **/ho-so**: gửi ảnh CCCD/căn cước/VNeID + ảnh chụp người.
2. Claude đọc thông tin, hỏi chức danh, làm ảnh 3×4 nền trắng, cho HR xác nhận rồi xuất **một file `.json` mỗi người**.
   Skill không kết nối mạng hay cơ sở dữ liệu, gói skill không chứa bí mật nên chia sẻ chung được.
3. HR đăng nhập web → **Nhân sự** → **Nhập từ Claude** → chọn một hoặc nhiều file.
4. Web hỏi máy chủ (chế độ xem trước, không ghi) và hiện từng người:
   - CCCD chưa có → hồ sơ mới, mã dự kiến, bắt buộc nhập **số điện thoại** (EMP-02) nếu file không có.
   - CCCD đã có → bảng "đang lưu / từ file", chọn có thay ảnh hay không.
5. Bấm **Lưu** → Edge Function `ho-so` tạo/cập nhật hồ sơ, lưu ảnh vào `hr-files/employees/<id>`, ghi nhật ký
   `employee.create` / `employee.update` (nguồn `web-nhap-tu-claude`, CCCD đã che).

Quy tắc: HOSO-01…04 trong `docs/rules.md`.

## Thành phần

| Phần | Vị trí |
|---|---|
| Quy tắc dùng chung (đọc file, cấp mã, so CCCD, kiểm tra) | `src/modules/claude-ho-so/hoSo.ts` (+ test 100%) |
| Màn hình | `src/app/_components/ClaudeHoSoImportModal.tsx`, nút trong `EmployeeListView.tsx` |
| Gọi máy chủ | `src/app/_components/claudeHoSoApi.ts` |
| Edge Function | `supabase/functions/ho-so/index.ts` |
| Quy tắc đóng gói cho function (tệp tạo tự động) | `supabase/functions/ho-so/hoSoRules.mjs` |

Function xác thực bằng phiên đăng nhập web và chỉ nhận vai trò `admin`/`hr` (bảng `profiles`); quyền ghi
không mở rộng ra ngoài luồng này (RLS của bảng `employees` giữ nguyên: chỉ admin ghi trực tiếp).

## Khi sửa quy tắc

```bash
npm test                     # test của module
npm run build:ho-so-fn       # đóng gói lại hoSoRules.mjs từ src/
supabase functions deploy ho-so --no-verify-jwt   # (function tự xác thực JWT bên trong)
```
Luôn đóng gói và triển khai lại function sau khi sửa `src/modules/claude-ho-so`, `src/modules/employees/rules.ts`,
`src/lib/vietnam/*` hoặc `src/messages.vi.ts`, để web và máy chủ áp cùng một bộ quy tắc.
