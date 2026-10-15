-- TNM HRM — phân quyền (RLS), hàm gia hạn chứng chỉ, dữ liệu loại chứng chỉ hệ thống.
-- Vai trò: admin = toàn quyền; hr = xem, xuất hồ sơ, ghi nhật ký, quản lý mẫu hồ sơ.
-- Người chưa đăng nhập (anon) không có quyền gì.

revoke execute on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;

-- profiles: mỗi người xem hồ sơ của mình; admin xem tất cả. Không ai tự đổi vai trò qua API.
create policy "profiles: xem của mình hoặc admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) = 'admin');

-- Bảng nghiệp vụ: admin + hr đọc; chỉ admin ghi. Không có xóa cứng (lưu trữ = cập nhật trạng thái).
create policy "employees: đọc" on public.employees for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "employees: admin thêm" on public.employees for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "employees: admin sửa" on public.employees for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy "commanders: đọc" on public.commanders for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "commanders: admin thêm" on public.commanders for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "commanders: admin sửa" on public.commanders for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy "certificate_types: đọc" on public.certificate_types for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "certificate_types: admin thêm" on public.certificate_types for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "certificate_types: admin sửa" on public.certificate_types for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy "certificates: đọc" on public.certificates for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "certificates: admin thêm" on public.certificates for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "certificates: admin sửa" on public.certificates for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy "signatures: đọc" on public.signatures for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "signatures: admin thêm" on public.signatures for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "signatures: admin sửa" on public.signatures for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy "signatures: admin xóa" on public.signatures for delete to authenticated using ((select public.app_role()) = 'admin');

create policy "settings: đọc" on public.settings for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "settings: admin sửa" on public.settings for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

-- Nhật ký: admin + hr ghi (hr mở CCCD cũng phải ghi), chỉ được ghi dưới tên chính mình; chỉ admin xem.
create policy "audit_events: ghi dưới tên mình" on public.audit_events for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'hr') and actor_id = (select auth.uid())::text);
create policy "audit_events: admin xem" on public.audit_events for select to authenticated using ((select public.app_role()) = 'admin');

create policy "reminder_log: đọc" on public.reminder_log for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "reminder_log: admin ghi" on public.reminder_log for insert to authenticated with check ((select public.app_role()) = 'admin');

-- Mẫu hồ sơ: admin + hr đều được tạo/sửa/xóa (theo yêu cầu 14/10/2026).
create policy "report_templates: đọc" on public.report_templates for select to authenticated using ((select public.app_role()) in ('admin', 'hr'));
create policy "report_templates: thêm" on public.report_templates for insert to authenticated with check ((select public.app_role()) in ('admin', 'hr'));
create policy "report_templates: sửa" on public.report_templates for update to authenticated using ((select public.app_role()) in ('admin', 'hr')) with check ((select public.app_role()) in ('admin', 'hr'));
create policy "report_templates: xóa" on public.report_templates for delete to authenticated using ((select public.app_role()) in ('admin', 'hr'));

-- Gia hạn: đánh dấu bản cũ "replaced" và thêm bản mới trong cùng một giao dịch.
-- security invoker → RLS vẫn áp dụng (chỉ admin làm được).
create function public.renew_certificate(p_old_id text, p_expected_version integer, p_old jsonb, p_new jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.certificates
     set version = (p_old ->> 'version')::integer,
         state = p_old ->> 'state',
         expiry_date = (p_old ->> 'expiryDate')::date,
         doc = p_old
   where id = p_old_id and version = p_expected_version;
  get diagnostics changed = row_count;
  if changed = 0 then
    return false;
  end if;
  insert into public.certificates (id, version, employee_id, type, state, expiry_date, doc)
  values (p_new ->> 'id', (p_new ->> 'version')::integer, p_new ->> 'employeeId', p_new ->> 'type', p_new ->> 'state', (p_new ->> 'expiryDate')::date, p_new);
  return true;
end;
$$;
revoke execute on function public.renew_certificate(text, integer, jsonb, jsonb) from public, anon;
grant execute on function public.renew_certificate(text, integer, jsonb, jsonb) to authenticated;

-- 7 loại chứng chỉ hệ thống (sinh từ SYSTEM_CERTIFICATE_TYPES trong code)
insert into public.certificate_types (id, version, key, doc) values
  ('ctype-atld', 1, 'atld', '{"id":"ctype-atld","key":"atld","name":"An toàn lao động","englishName":"Occupational safety","requiredForPositions":["Giám đốc","Nhân sự","Trưởng phòng kỹ thuật","Nhân viên kỹ thuật","Nhân viên hiện trường"],"sortOrder":1,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-health', 1, 'health', '{"id":"ctype-health","key":"health","name":"Khám sức khỏe","englishName":"Health examination","requiredForPositions":["Giám đốc","Nhân sự","Trưởng phòng kỹ thuật","Nhân viên kỹ thuật","Nhân viên hiện trường"],"sortOrder":2,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-ins', 1, 'ins', '{"id":"ctype-ins","key":"ins","name":"Bảo hiểm tai nạn lao động","englishName":"Occupational accident insurance","requiredForPositions":["Trưởng phòng kỹ thuật","Nhân viên kỹ thuật","Nhân viên hiện trường"],"sortOrder":3,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-elec', 1, 'elec', '{"id":"ctype-elec","key":"elec","name":"An toàn điện","englishName":"Electrical safety","requiredForPositions":["Trưởng phòng kỹ thuật","Nhân viên kỹ thuật","Nhân viên hiện trường"],"sortOrder":4,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-weld', 1, 'weld', '{"id":"ctype-weld","key":"weld","name":"Chứng chỉ hàn","englishName":"Welding certificate","requiredForPositions":[],"sortOrder":5,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-crane', 1, 'crane', '{"id":"ctype-crane","key":"crane","name":"Vận hành cần cẩu","englishName":"Crane operation","requiredForPositions":[],"sortOrder":6,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb),
  ('ctype-fork', 1, 'fork', '{"id":"ctype-fork","key":"fork","name":"Vận hành xe nâng hàng","englishName":"Forklift operation","requiredForPositions":[],"sortOrder":7,"system":true,"archived":false,"archiveReason":null,"version":1}'::jsonb)
on conflict (id) do nothing;
