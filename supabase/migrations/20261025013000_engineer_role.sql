-- Vai trò 'engineer' (Kỹ sư): đăng nhập để dùng trang Công cụ (Ảnh Trước / Sau, tách nền...) và Kho Skill AI.
-- Giống 'employee' ở chỗ bị chặn khỏi dữ liệu nhân sự, chứng chỉ, chữ ký, mẫu báo cáo, đối tác
-- (các policy đó chỉ cho 'admin'/'hr'); khác ở chỗ được dùng công cụ ảnh Trước / Sau.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'hr', 'engineer', 'employee', 'pending'));
comment on table public.profiles is 'Vai trò người dùng: admin (toàn quyền), hr (xem, xuất, quản lý mẫu hồ sơ), engineer (Kỹ sư: trang Công cụ và Kho Skill AI), employee (chỉ Kho Skill AI và Công cụ), pending (mới đăng ký, chưa được cấp quyền).';

-- Công cụ ảnh Trước / Sau: thêm 'engineer' vào mọi quyền đọc / thêm / sửa (vẫn không có quyền xóa cứng).
alter policy "photo_sites: đọc" on public.photo_sites using ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
alter policy "photo_sites: thêm" on public.photo_sites with check ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
alter policy "photo_sites: sửa" on public.photo_sites
  using ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'))
  with check ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));

alter policy "photo_items: đọc" on public.photo_items using ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
alter policy "photo_items: thêm" on public.photo_items with check ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
alter policy "photo_items: sửa" on public.photo_items
  using ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'))
  with check ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));

alter policy "site-photos: đọc" on storage.objects
  using (bucket_id = 'site-photos' and (select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
alter policy "site-photos: thêm" on storage.objects
  with check (bucket_id = 'site-photos' and (select private.app_role()) in ('admin', 'hr', 'engineer', 'employee'));
