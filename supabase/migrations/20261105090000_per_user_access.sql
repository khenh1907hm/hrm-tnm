-- Quyền theo từng người: Admin tick từng mục cho mỗi tài khoản, kể cả người ở bộ phận khác (vd Kỹ sư học thêm việc nhân sự).
-- profiles.permissions = null  → mặc định theo vai trò: HR đủ mọi mục, Kỹ sư và Nhân viên chỉ có Công cụ.
-- profiles.permissions = mảng  → đúng các mục đã tick. Admin luôn đủ quyền, Chờ cấp quyền luôn không có gì.
-- Tài khoản hiện có đều là null nên không ai đổi quyền khi chạy migration này.
-- Danh mục khóa phải khớp ACCESS_ITEMS ở src/modules/auth/permissions.ts.
-- Tạo lại theo tên (drop if exists) nên chạy lại nhiều lần vẫn ra cùng kết quả.

alter table public.profiles add column if not exists permissions text[];
alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles add constraint profiles_permissions_check check (permissions <@ array[
  'employees.view', 'employees.edit', 'employees.import', 'employees.export', 'employees.archive',
  'certificates.edit', 'certificateTypes.manage', 'reminders.manage',
  'signatures.manage', 'reports.manage', 'tools'
]::text[]);
comment on column public.profiles.permissions is 'Các mục quyền Admin tick riêng cho người này; null là mặc định theo vai trò.';

create or replace function private.has_access(item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      when p.role not in ('hr', 'engineer', 'employee') then false
      when p.permissions is not null then item = any (p.permissions)
      when p.role = 'hr' then true
      else item = 'tools'
    end
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;
revoke execute on function private.has_access(text) from public, anon;
grant execute on function private.has_access(text) to authenticated;

-- Nhân sự. Nhập chỉ thêm mới; lưu trữ, khôi phục là cập nhật.
drop policy if exists "employees: đọc" on public.employees;
create policy "employees: đọc" on public.employees for select to authenticated using ((select private.has_access('employees.view')));
drop policy if exists "employees: admin, hr thêm" on public.employees;
drop policy if exists "employees: thêm" on public.employees;
create policy "employees: thêm" on public.employees for insert to authenticated
  with check ((select private.has_access('employees.edit')) or (select private.has_access('employees.import')));
drop policy if exists "employees: admin, hr sửa" on public.employees;
drop policy if exists "employees: sửa" on public.employees;
create policy "employees: sửa" on public.employees for update to authenticated
  using ((select private.has_access('employees.edit')) or (select private.has_access('employees.archive')))
  with check ((select private.has_access('employees.edit')) or (select private.has_access('employees.archive')));

drop policy if exists "commanders: đọc" on public.commanders;
create policy "commanders: đọc" on public.commanders for select to authenticated using ((select private.has_access('employees.view')));
drop policy if exists "commanders: admin, hr thêm" on public.commanders;
drop policy if exists "commanders: thêm" on public.commanders;
create policy "commanders: thêm" on public.commanders for insert to authenticated with check ((select private.has_access('employees.edit')));
drop policy if exists "commanders: admin, hr sửa" on public.commanders;
drop policy if exists "commanders: sửa" on public.commanders;
create policy "commanders: sửa" on public.commanders for update to authenticated
  using ((select private.has_access('employees.edit'))) with check ((select private.has_access('employees.edit')));

-- Chứng chỉ (renew_certificate chạy security invoker nên cũng đi qua các policy này).
drop policy if exists "certificates: đọc" on public.certificates;
create policy "certificates: đọc" on public.certificates for select to authenticated using ((select private.has_access('employees.view')));
drop policy if exists "certificates: admin, hr thêm" on public.certificates;
drop policy if exists "certificates: thêm" on public.certificates;
create policy "certificates: thêm" on public.certificates for insert to authenticated with check ((select private.has_access('certificates.edit')));
drop policy if exists "certificates: admin, hr sửa" on public.certificates;
drop policy if exists "certificates: sửa" on public.certificates;
create policy "certificates: sửa" on public.certificates for update to authenticated
  using ((select private.has_access('certificates.edit'))) with check ((select private.has_access('certificates.edit')));

drop policy if exists "certificate_types: đọc" on public.certificate_types;
create policy "certificate_types: đọc" on public.certificate_types for select to authenticated using ((select private.has_access('employees.view')));
drop policy if exists "certificate_types: admin, hr thêm" on public.certificate_types;
drop policy if exists "certificate_types: thêm" on public.certificate_types;
create policy "certificate_types: thêm" on public.certificate_types for insert to authenticated with check ((select private.has_access('certificateTypes.manage')));
drop policy if exists "certificate_types: admin, hr sửa" on public.certificate_types;
drop policy if exists "certificate_types: sửa" on public.certificate_types;
create policy "certificate_types: sửa" on public.certificate_types for update to authenticated
  using ((select private.has_access('certificateTypes.manage'))) with check ((select private.has_access('certificateTypes.manage')));

-- Chữ ký: người xuất hồ sơ và người làm mẫu báo cáo cần đọc để chọn người ký.
drop policy if exists "signatures: đọc" on public.signatures;
create policy "signatures: đọc" on public.signatures for select to authenticated
  using ((select private.has_access('signatures.manage')) or (select private.has_access('employees.export')) or (select private.has_access('reports.manage')));
drop policy if exists "signatures: admin, hr thêm" on public.signatures;
drop policy if exists "signatures: thêm" on public.signatures;
create policy "signatures: thêm" on public.signatures for insert to authenticated with check ((select private.has_access('signatures.manage')));
drop policy if exists "signatures: admin, hr sửa" on public.signatures;
drop policy if exists "signatures: sửa" on public.signatures;
create policy "signatures: sửa" on public.signatures for update to authenticated
  using ((select private.has_access('signatures.manage'))) with check ((select private.has_access('signatures.manage')));
drop policy if exists "signatures: admin, hr xóa" on public.signatures;
drop policy if exists "signatures: xóa" on public.signatures;
create policy "signatures: xóa" on public.signatures for delete to authenticated using ((select private.has_access('signatures.manage')));

-- Cài đặt: dòng 'global' (email nhắc hạn) khác dòng cấu hình tải thư mục chứng chỉ (dùng khi xuất).
drop policy if exists "settings: đọc" on public.settings;
create policy "settings: đọc" on public.settings for select to authenticated using (
  (id = 'global' and (select private.has_access('reminders.manage')))
  or (id = 'certificate-folder-presets' and ((select private.has_access('employees.export')) or (select private.has_access('reports.manage'))))
);
drop policy if exists "settings: admin, hr sửa" on public.settings;
drop policy if exists "settings: sửa" on public.settings;
create policy "settings: sửa" on public.settings for update to authenticated
  using (
    (id = 'global' and (select private.has_access('reminders.manage')))
    or (id = 'certificate-folder-presets' and ((select private.has_access('employees.export')) or (select private.has_access('reports.manage'))))
  )
  with check (
    (id = 'global' and (select private.has_access('reminders.manage')))
    or (id = 'certificate-folder-presets' and ((select private.has_access('employees.export')) or (select private.has_access('reports.manage'))))
  );

-- Danh sách cảnh báo hiện "đã gửi nhắc" nên ai xem nhân sự cũng cần đọc nhật ký gửi.
drop policy if exists "reminder_log: đọc" on public.reminder_log;
create policy "reminder_log: đọc" on public.reminder_log for select to authenticated using ((select private.has_access('employees.view')));
drop policy if exists "reminder_log: admin, hr ghi" on public.reminder_log;
drop policy if exists "reminder_log: ghi" on public.reminder_log;
create policy "reminder_log: ghi" on public.reminder_log for insert to authenticated with check ((select private.has_access('reminders.manage')));

-- Mẫu báo cáo: người xuất lưu được quy tắc đặt tên vào mẫu. Lưu mẫu là upsert nên cần cả thêm lẫn sửa.
drop policy if exists "report_templates: đọc" on public.report_templates;
create policy "report_templates: đọc" on public.report_templates for select to authenticated
  using ((select private.has_access('reports.manage')) or (select private.has_access('employees.export')));
drop policy if exists "report_templates: thêm" on public.report_templates;
create policy "report_templates: thêm" on public.report_templates for insert to authenticated
  with check ((select private.has_access('reports.manage')) or (select private.has_access('employees.export')));
drop policy if exists "report_templates: sửa" on public.report_templates;
create policy "report_templates: sửa" on public.report_templates for update to authenticated
  using ((select private.has_access('reports.manage')) or (select private.has_access('employees.export')))
  with check ((select private.has_access('reports.manage')) or (select private.has_access('employees.export')));
drop policy if exists "report_templates: xóa" on public.report_templates;
create policy "report_templates: xóa" on public.report_templates for delete to authenticated using ((select private.has_access('reports.manage')));

drop policy if exists "partners: đọc" on public.partners;
create policy "partners: đọc" on public.partners for select to authenticated
  using ((select private.has_access('reports.manage')) or (select private.has_access('employees.export')));
drop policy if exists "partners: thêm" on public.partners;
create policy "partners: thêm" on public.partners for insert to authenticated with check ((select private.has_access('reports.manage')));
drop policy if exists "partners: sửa" on public.partners;
create policy "partners: sửa" on public.partners for update to authenticated
  using ((select private.has_access('reports.manage'))) with check ((select private.has_access('reports.manage')));
drop policy if exists "partners: xóa" on public.partners;
create policy "partners: xóa" on public.partners for delete to authenticated using ((select private.has_access('reports.manage')));

-- Nhật ký: ai đã được cấp vai trò đều ghi được, nhưng chỉ dưới tên chính mình; xem vẫn chỉ Admin.
drop policy if exists "audit_events: ghi dưới tên mình" on public.audit_events;
create policy "audit_events: ghi dưới tên mình" on public.audit_events for insert to authenticated
  with check ((select private.app_role()) in ('admin', 'hr', 'engineer', 'employee') and actor_id = (select auth.uid())::text);

-- Kho tệp hr-files: phân theo thư mục đầu của đường dẫn.
drop policy if exists "hr-files: đọc (admin, hr)" on storage.objects;
drop policy if exists "hr-files: đọc" on storage.objects;
create policy "hr-files: đọc" on storage.objects for select to authenticated using (bucket_id = 'hr-files' and (
  ((storage.foldername(name))[1] in ('certificates', 'employees') and (select private.has_access('employees.view')))
  or ((storage.foldername(name))[1] = 'signatures' and ((select private.has_access('signatures.manage')) or (select private.has_access('employees.export')) or (select private.has_access('reports.manage'))))
  or ((storage.foldername(name))[1] = 'templates' and ((select private.has_access('reports.manage')) or (select private.has_access('employees.export'))))
));
drop policy if exists "hr-files: thêm" on storage.objects;
create policy "hr-files: thêm" on storage.objects for insert to authenticated with check (bucket_id = 'hr-files' and (
  ((storage.foldername(name))[1] = 'certificates' and (select private.has_access('certificates.edit')))
  or ((storage.foldername(name))[1] = 'employees' and (select private.has_access('employees.edit')))
  or ((storage.foldername(name))[1] = 'signatures' and (select private.has_access('signatures.manage')))
  or ((storage.foldername(name))[1] = 'templates' and (select private.has_access('reports.manage')))
));
drop policy if exists "hr-files: sửa" on storage.objects;
create policy "hr-files: sửa" on storage.objects for update to authenticated
  using (bucket_id = 'hr-files' and (
    ((storage.foldername(name))[1] = 'certificates' and (select private.has_access('certificates.edit')))
    or ((storage.foldername(name))[1] = 'employees' and (select private.has_access('employees.edit')))
    or ((storage.foldername(name))[1] = 'signatures' and (select private.has_access('signatures.manage')))
    or ((storage.foldername(name))[1] = 'templates' and (select private.has_access('reports.manage')))
  ))
  with check (bucket_id = 'hr-files' and (
    ((storage.foldername(name))[1] = 'certificates' and (select private.has_access('certificates.edit')))
    or ((storage.foldername(name))[1] = 'employees' and (select private.has_access('employees.edit')))
    or ((storage.foldername(name))[1] = 'signatures' and (select private.has_access('signatures.manage')))
    or ((storage.foldername(name))[1] = 'templates' and (select private.has_access('reports.manage')))
  ));
drop policy if exists "hr-files: xóa" on storage.objects;
create policy "hr-files: xóa" on storage.objects for delete to authenticated using (bucket_id = 'hr-files' and (
  ((storage.foldername(name))[1] = 'certificates' and (select private.has_access('certificates.edit')))
  or ((storage.foldername(name))[1] = 'employees' and (select private.has_access('employees.edit')))
  or ((storage.foldername(name))[1] = 'signatures' and (select private.has_access('signatures.manage')))
  or ((storage.foldername(name))[1] = 'templates' and (select private.has_access('reports.manage')))
));

-- Công cụ ảnh Trước / Sau.
drop policy if exists "photo_sites: đọc" on public.photo_sites;
create policy "photo_sites: đọc" on public.photo_sites for select to authenticated using ((select private.has_access('tools')));
drop policy if exists "photo_sites: thêm" on public.photo_sites;
create policy "photo_sites: thêm" on public.photo_sites for insert to authenticated with check ((select private.has_access('tools')));
drop policy if exists "photo_sites: sửa" on public.photo_sites;
create policy "photo_sites: sửa" on public.photo_sites for update to authenticated
  using ((select private.has_access('tools'))) with check ((select private.has_access('tools')));
drop policy if exists "photo_items: đọc" on public.photo_items;
create policy "photo_items: đọc" on public.photo_items for select to authenticated using ((select private.has_access('tools')));
drop policy if exists "photo_items: thêm" on public.photo_items;
create policy "photo_items: thêm" on public.photo_items for insert to authenticated with check ((select private.has_access('tools')));
drop policy if exists "photo_items: sửa" on public.photo_items;
create policy "photo_items: sửa" on public.photo_items for update to authenticated
  using ((select private.has_access('tools'))) with check ((select private.has_access('tools')));
drop policy if exists "site-photos: đọc" on storage.objects;
create policy "site-photos: đọc" on storage.objects for select to authenticated using (bucket_id = 'site-photos' and (select private.has_access('tools')));
drop policy if exists "site-photos: thêm" on storage.objects;
create policy "site-photos: thêm" on storage.objects for insert to authenticated with check (bucket_id = 'site-photos' and (select private.has_access('tools')));
