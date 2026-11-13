-- Rà soát bảo mật (13/11/2026):
--  * Tài khoản "chờ cấp quyền" (pending, vd ai đó tự đăng ký khi Supabase còn mở đăng ký) không đọc được bảng nào, không gửi báo lỗi:
--    các chính sách đọc "true" và 3 hàm liệt kê tên người đổi sang private.is_member().
--  * Báo lỗi: đường dẫn trang chỉ là đường dẫn nội bộ (bắt đầu bằng "/"); người gửi không sửa được nội dung, trang sau khi gửi.
--  * Dự án: chỉ Admin, Giám đốc chuyển "Kế hoạch" → "Đang thi công" khi Confirm Contract chưa được duyệt.
--  * Kho tệp mới chỉ nhận loại tệp văn phòng / ảnh / bản vẽ / nén (chặn HTML, script).

create or replace function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role in ('admin', 'hr', 'engineer', 'employee') from public.profiles where id = (select auth.uid())), false);
$$;
revoke all on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

-- Chính sách đọc mở → chỉ thành viên
drop policy if exists "cost_codes: đọc" on public.cost_codes;
create policy "cost_codes: đọc" on public.cost_codes for select to authenticated using ((select private.is_member()));
drop policy if exists "holidays: đọc" on public.holidays;
create policy "holidays: đọc" on public.holidays for select to authenticated using ((select private.is_member()));
drop policy if exists "labor_settings: đọc" on public.labor_settings;
create policy "labor_settings: đọc" on public.labor_settings for select to authenticated using ((select private.is_member()));
drop policy if exists "org_chart_template: đọc" on public.org_chart_template;
create policy "org_chart_template: đọc" on public.org_chart_template for select to authenticated using ((select private.is_member()));
drop policy if exists "procurement_settings: đọc" on public.procurement_settings;
create policy "procurement_settings: đọc" on public.procurement_settings for select to authenticated using ((select private.is_member()));
drop policy if exists "purchase_settings: đọc" on public.purchase_settings;
create policy "purchase_settings: đọc" on public.purchase_settings for select to authenticated using ((select private.is_member()));

create or replace function public.director_people()
returns table (employee_id text, name text)
language sql stable security definer set search_path = '' as $$
  select p.employee_id, coalesce(nullif(p.full_name, ''), e.doc ->> 'name', e.code)
  from public.profiles p left join public.employees e on e.id = p.employee_id
  where p.is_director and p.employee_id is not null and (select private.is_member());
$$;

create or replace function public.procurement_departments()
returns table (department text, employee_id text, name text)
language sql stable security definer set search_path = '' as $$
  select d.key, e.id, coalesce(e.doc ->> 'name', e.code)
  from public.procurement_settings s, jsonb_each(s.departments) d, jsonb_array_elements_text(d.value) with ordinality m(id, ord)
  join public.employees e on e.id = m.id
  where s.id = 1 and (select private.is_member())
  order by d.key, m.ord;
$$;

create or replace function public.purchase_approvers()
returns table (employee_id text, name text, has_account boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, coalesce(e.doc ->> 'name', e.code), exists (select 1 from public.profiles p where p.employee_id = e.id)
  from public.employees e
  where e.id = any (coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) and (select private.is_member());
$$;

-- Báo lỗi
drop policy if exists "bug_reports: gửi" on public.bug_reports;
create policy "bug_reports: gửi" on public.bug_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member()));
alter table public.bug_reports drop constraint if exists bug_reports_page_url_check;
alter table public.bug_reports add constraint bug_reports_page_url_check check (page_url = '' or (page_url like '/%' and page_url not like '//%' and char_length(page_url) <= 500));

create or replace function private.bug_report_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.admin_note := '';
    new.resolved_at := null;
    new.screenshot_path := '';
    new.reporter_name := coalesce(nullif((select full_name from public.profiles where id = new.user_id), ''),
      (select coalesce(e.doc ->> 'name', e.code) from public.profiles pr join public.employees e on e.id = pr.employee_id where pr.id = new.user_id), '');
    new.reporter_email := coalesce((select email from auth.users where id = new.user_id), '');
  elsif not (select private.is_admin()) then
    -- Người gửi chỉ gắn ảnh chụp (một lần, đúng thư mục của báo lỗi này)
    new.status := old.status; new.admin_note := old.admin_note; new.resolved_at := old.resolved_at;
    new.message := old.message; new.page_url := old.page_url; new.user_agent := old.user_agent;
    new.reporter_name := old.reporter_name; new.reporter_email := old.reporter_email; new.user_id := old.user_id; new.created_at := old.created_at;
    if old.screenshot_path <> '' or new.screenshot_path not like old.id::text || '/%' then new.screenshot_path := old.screenshot_path; end if;
  elsif new.status = 'done' and old.status <> 'done' then
    new.resolved_at := now();
  elsif new.status = 'open' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

-- Dự án chỉ chạy khi Confirm Contract được duyệt (Admin, Giám đốc mở thay được)
create or replace function private.project_status_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'planning' and new.status in ('active', 'paused', 'done')
     and auth.uid() is not null
     and not ((select private.is_admin()) or (select private.is_director()))
     and not exists (select 1 from public.project_contracts c where c.project_id = new.id and c.status = 'approved') then
    raise exception 'PROJECT_CONTRACT_NOT_APPROVED';
  end if;
  return new;
end;
$$;
drop trigger if exists project_status_guard on public.projects;
create trigger project_status_guard before update of status on public.projects for each row execute function private.project_status_guard();

-- Loại tệp cho phép ở các kho mới
update storage.buckets set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed',
  'image/vnd.dwg', 'application/acad', 'application/dwg', 'image/vnd.dxf', 'application/dxf',
  'application/vnd.ms-outlook', 'message/rfc822', 'text/plain', 'text/csv', 'application/octet-stream'
] where id in ('purchase-files', 'project-files');
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'] where id = 'bug-files';
