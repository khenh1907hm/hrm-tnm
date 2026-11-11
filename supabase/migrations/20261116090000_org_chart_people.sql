-- Chọn người cho Sơ đồ tổ chức dự án khi không có quyền xem hồ sơ nhân sự (PM, CHT, kỹ sư dùng giao diện nhân viên).
-- Chỉ trả mã, tên, chức vụ, số điện thoại của nhân sự đang làm (không CCCD, địa chỉ hay giấy tờ).
-- Được gọi: Admin, quyền xem nhân sự, quyền xem dự án, quyền Công cụ, hoặc giữ vai trò quản lý (không phải tổ viên) trong một dự án.

create or replace function private.can_pick_org_people()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or (select private.has_access('employees.view'))
    or (select private.has_access('projects.view'))
    or (select private.has_access('tools'))
    or exists (select 1 from public.project_members m where m.employee_id = (select private.my_employee_id()) and m.role <> 'worker');
$$;
revoke all on function private.can_pick_org_people() from public, anon;
grant execute on function private.can_pick_org_people() to authenticated;

create or replace function public.org_chart_people(p_query text default '', p_id text default null)
returns table (id text, code text, name text, "position" text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.code, e.doc ->> 'name', coalesce(e.doc ->> 'position', ''), coalesce(e.doc ->> 'phone', '')
  from public.employees e
  where (select private.can_pick_org_people())
    and (p_id is null or e.id = p_id)
    and coalesce(e.doc ->> 'archivedAt', '') = ''
    and coalesce(e.doc ->> 'status', 'active') <> 'resigned'
    and (coalesce(btrim(p_query), '') = '' or lower(e.code || ' ' || coalesce(e.doc ->> 'name', '')) like '%' || lower(btrim(p_query)) || '%')
  order by e.code
  limit 100;
$$;
revoke all on function public.org_chart_people(text, text) from public, anon;
grant execute on function public.org_chart_people(text, text) to authenticated;
