-- TNM HRM — kho file riêng tư.
-- Cấu trúc đường dẫn trong bucket `hr-files`:
--   certificates/<certificateId>/<fileId>   ảnh/PDF chứng chỉ
--   employees/<employeeId>/<fileId>         ảnh 3×4, ảnh CCCD
--   signatures/<signatureId>/<fileId>       ảnh chữ ký đã tách nền
--   templates/<templateId>/<fileId>         file mẫu .xlsx
-- Không public: tải về cần đăng nhập (URL ký có thời hạn).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-files', 'hr-files', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

create policy "hr-files: đọc (admin, hr)" on storage.objects for select to authenticated
  using (bucket_id = 'hr-files' and (select public.app_role()) in ('admin', 'hr'));

-- Admin ghi mọi thư mục; hr chỉ ghi thư mục templates/ (mẫu hồ sơ).
create policy "hr-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-files' and ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'hr' and (storage.foldername(name))[1] = 'templates')));

create policy "hr-files: sửa" on storage.objects for update to authenticated
  using (bucket_id = 'hr-files' and ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'hr' and (storage.foldername(name))[1] = 'templates')))
  with check (bucket_id = 'hr-files' and ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'hr' and (storage.foldername(name))[1] = 'templates')));

create policy "hr-files: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'hr-files' and ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'hr' and (storage.foldername(name))[1] = 'templates')));
