-- Vai trò 'employee' (nhân viên): đăng nhập chỉ dùng Kho Skill AI và trang Công cụ.
-- Mọi policy dữ liệu nhân sự, chứng chỉ, chữ ký, mẫu báo cáo, đối tác chỉ cho 'admin'/'hr',
-- nên 'employee' bị chặn ở các bảng đó như 'pending'; skill_posts vẫn đọc công khai.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'hr', 'employee', 'pending'));
comment on table public.profiles is 'Vai trò người dùng: admin (toàn quyền), hr (xem, xuất, quản lý mẫu hồ sơ), employee (chỉ Kho Skill AI và Công cụ), pending (mới đăng ký, chưa được cấp quyền).';
