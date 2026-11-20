-- App điện thoại: báo cáo ngày.
-- 1) Danh sách dự án đang thi công mà người đăng nhập được lập báo cáo ngày (PM / CHT của dự án hoặc người quản lý dự án),
--    cùng điều kiện với daily_report_can_send.
-- 2) Tên thành viên đang làm ở dự án, để gợi ý khi nhập tổ trưởng / người làm / người vắng.
-- Chỉ đọc, không đổi bảng.

create or replace function public.my_daily_report_projects()
returns table (project_id uuid, code text, name text, site text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.name, coalesce(p.site, '')
  from public.projects p
  where p.status = 'active'
    and ((select private.is_project_lead(p.id)) or (select private.can_manage_projects()))
  order by p.code;
$$;

create or replace function public.daily_report_roster(p_project uuid)
returns table (name text, code text, team text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select public.daily_report_can_send(p_project)) then raise exception 'FORBIDDEN'; end if;
  return query
    select m.display_name, coalesce(m.employee_code, ''), coalesce(m.team, '')
    from public.project_members m
    where m.project_id = p_project
      and m.joined_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
      and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
    order by m.display_name;
end;
$$;

revoke all on function public.my_daily_report_projects(), public.daily_report_roster(uuid) from public, anon;
grant execute on function public.my_daily_report_projects(), public.daily_report_roster(uuid) to authenticated;
