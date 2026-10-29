-- HR xử lý toàn bộ nghiệp vụ nhân sự và hành chính: thêm / sửa / lưu trữ nhân sự, chứng chỉ, loại chứng chỉ,
-- chữ ký, chỉ huy trưởng, cài đặt email, gửi nhắc hạn và mọi thư mục trong kho tệp hr-files.
-- Vẫn chỉ Admin: đọc nhật ký (audit_events), xem hồ sơ người khác trong profiles, quản trị Kho Skill.
-- Tạo lại theo tên (drop if exists cả tên cũ lẫn tên mới) nên chạy lại nhiều lần vẫn ra cùng kết quả.

drop policy if exists "employees: admin thêm" on public.employees;
drop policy if exists "employees: admin sửa" on public.employees;
drop policy if exists "employees: admin, hr thêm" on public.employees;
create policy "employees: admin, hr thêm" on public.employees for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "employees: admin, hr sửa" on public.employees;
create policy "employees: admin, hr sửa" on public.employees for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "commanders: admin thêm" on public.commanders;
drop policy if exists "commanders: admin sửa" on public.commanders;
drop policy if exists "commanders: admin, hr thêm" on public.commanders;
create policy "commanders: admin, hr thêm" on public.commanders for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "commanders: admin, hr sửa" on public.commanders;
create policy "commanders: admin, hr sửa" on public.commanders for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "certificate_types: admin thêm" on public.certificate_types;
drop policy if exists "certificate_types: admin sửa" on public.certificate_types;
drop policy if exists "certificate_types: admin, hr thêm" on public.certificate_types;
create policy "certificate_types: admin, hr thêm" on public.certificate_types for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "certificate_types: admin, hr sửa" on public.certificate_types;
create policy "certificate_types: admin, hr sửa" on public.certificate_types for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "certificates: admin thêm" on public.certificates;
drop policy if exists "certificates: admin sửa" on public.certificates;
drop policy if exists "certificates: admin, hr thêm" on public.certificates;
create policy "certificates: admin, hr thêm" on public.certificates for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "certificates: admin, hr sửa" on public.certificates;
create policy "certificates: admin, hr sửa" on public.certificates for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "signatures: admin thêm" on public.signatures;
drop policy if exists "signatures: admin sửa" on public.signatures;
drop policy if exists "signatures: admin xóa" on public.signatures;
drop policy if exists "signatures: admin, hr thêm" on public.signatures;
create policy "signatures: admin, hr thêm" on public.signatures for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "signatures: admin, hr sửa" on public.signatures;
create policy "signatures: admin, hr sửa" on public.signatures for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));
drop policy if exists "signatures: admin, hr xóa" on public.signatures;
create policy "signatures: admin, hr xóa" on public.signatures for delete to authenticated using ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "settings: admin sửa" on public.settings;
drop policy if exists "settings: admin, hr sửa" on public.settings;
create policy "settings: admin, hr sửa" on public.settings for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "reminder_log: admin ghi" on public.reminder_log;
drop policy if exists "reminder_log: admin, hr ghi" on public.reminder_log;
create policy "reminder_log: admin, hr ghi" on public.reminder_log for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));

drop policy if exists "hr-files: thêm" on storage.objects;
drop policy if exists "hr-files: sửa" on storage.objects;
drop policy if exists "hr-files: xóa" on storage.objects;
create policy "hr-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-files' and (select private.app_role()) in ('admin', 'hr'));
create policy "hr-files: sửa" on storage.objects for update to authenticated
  using (bucket_id = 'hr-files' and (select private.app_role()) in ('admin', 'hr'))
  with check (bucket_id = 'hr-files' and (select private.app_role()) in ('admin', 'hr'));
create policy "hr-files: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'hr-files' and (select private.app_role()) in ('admin', 'hr'));

-- Cấu hình "Tải thư mục chứng chỉ" dùng chung cho mọi người, mọi máy (trước đây chỉ lưu trên trình duyệt).
-- Bảng settings trước chỉ cho dòng 'global'; mở thêm dòng này (không có policy insert nên người dùng không tự thêm dòng khác).
alter table public.settings drop constraint if exists settings_id_check;
alter table public.settings add constraint settings_id_check check (id in ('global', 'certificate-folder-presets'));
insert into public.settings (id, doc) values ('certificate-folder-presets', '{}'::jsonb) on conflict (id) do nothing;
