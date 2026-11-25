-- Tên người ký in lên biểu mẫu: không dùng email.
-- Tài khoản chưa có họ tên và chưa liên kết hồ sơ: Admin ghi "Admin", người khác ghi phần trước @ của email.
create or replace function private.approval_signer_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signer_id is not null and coalesce(new.signer_name, '') = '' then
    new.signer_name := coalesce(
      nullif((select full_name from public.profiles where id = new.signer_id), ''),
      (select coalesce(e.doc ->> 'name', e.code) from public.profiles pr join public.employees e on e.id = pr.employee_id where pr.id = new.signer_id),
      (select case when pr.role = 'admin' then 'Admin' end from public.profiles pr where pr.id = new.signer_id),
      (select split_part(email, '@', 1) from auth.users where id = new.signer_id),
      '');
  end if;
  return new;
end;
$$;

-- Bước đã ký trước đây còn lưu email: giao diện và biểu mẫu tự đổi khi hiện (signerLabel), không sửa dữ liệu cũ.
