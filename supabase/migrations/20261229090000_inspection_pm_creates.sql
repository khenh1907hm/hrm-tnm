-- Báo cáo công trình: trưởng dự án (PM) cũng lập được báo cáo cho dự án của mình, chụp lỗi rồi giao cho chỉ huy trưởng.
-- Sếp / người được chỉ định lập → giao PM (như cũ); PM lập → giao chỉ huy trưởng (commander) của dự án.

create or replace function private.can_create_inspection(pid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select (select private.is_site_inspector()) or (select private.is_project_pm(pid)); $$;
revoke all on function private.can_create_inspection(uuid) from public, anon;

drop policy if exists "site_inspections: thêm" on public.site_inspections;
create policy "site_inspections: thêm" on public.site_inspections for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select private.can_create_inspection(project_id)) and status = 'draft');

drop function if exists public.site_inspection_projects();
create function public.site_inspection_projects()
returns table (project_id uuid, code text, name text, site text, status text, pm_employee_id text, pm_name text,
  commander_employee_id text, commander_name text, can_create boolean, assignee_employee_id text, assignee_name text)
language sql stable security definer set search_path = ''
as $$
  with base as (
    select p.id, p.code, p.name, coalesce(p.site, '') site, p.status::text status, p.pm_employee_id, coalesce(e.doc ->> 'name', '') pm_name,
      c.employee_id commander_employee_id, coalesce(c.name, '') commander_name,
      (select private.can_create_inspection(p.id)) can_create,
      -- người lập là PM (không phải Sếp / người được chỉ định) → giao chỉ huy trưởng
      (p.pm_employee_id = (select private.my_employee_id()) or 'pm' = any (private.project_roles(p.id))) and not (select private.is_site_inspector()) by_pm
    from public.projects p
    left join public.employees e on e.id::text = p.pm_employee_id
    left join lateral (
      select m.employee_id, coalesce(nullif(m.display_name, ''), ce.doc ->> 'name', '') name
      from public.project_members m left join public.employees ce on ce.id::text = m.employee_id
      where m.project_id = p.id and m.role = 'commander' and m.left_on is null and m.employee_id is not null
      order by m.created_at limit 1
    ) c on true
    where p.status in ('active', 'paused') and ((select private.is_site_inspector()) or (select private.can_view_project(p.id)))
  )
  select id, code, name, site, status, pm_employee_id, pm_name, commander_employee_id, commander_name, can_create,
    case when by_pm then commander_employee_id else pm_employee_id end,
    case when by_pm then commander_name else pm_name end
  from base order by code;
$$;
revoke all on function public.site_inspection_projects() from public, anon;
grant execute on function public.site_inspection_projects() to authenticated;

create or replace function public.site_inspection_can_create()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select private.is_site_inspector())
    or exists (select 1 from public.projects p where p.status in ('active', 'paused') and (select private.is_project_pm(p.id)));
$$;
