-- Tài khoản mới không còn tự có quyền HR: nhận vai trò 'pending' (không xem được dữ liệu)
-- cho đến khi admin cấp quyền bằng SQL/bảng điều khiển.
-- Mọi policy chỉ cho 'admin'/'hr' nên 'pending' bị chặn ở tất cả các bảng và kho tệp.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'hr', 'pending'));
alter table public.profiles alter column role set default 'pending';
comment on table public.profiles is 'Vai trò người dùng: admin (toàn quyền), hr (xem, xuất, quản lý mẫu hồ sơ), pending (mới đăng ký, chưa được cấp quyền).';
