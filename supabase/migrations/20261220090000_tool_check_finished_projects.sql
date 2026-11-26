-- Kiểm tra dụng cụ: liệt kê cả dự án tạm dừng / đã xong để nhập bù phiếu các tháng trước (dự án đã chạy).
-- Dự án đang thi công lên trước; thêm cột status để app ghi chú "Đã xong" / "Tạm dừng".
drop function if exists public.my_tool_check_projects();
create function public.my_tool_check_projects()
returns table (project_id uuid, code text, name text, site text, has_template boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.name, coalesce(p.site, ''), exists (select 1 from public.tool_check_templates t where t.project_id = p.id and jsonb_array_length(t.rows) > 0), p.status::text
  from public.projects p
  where p.status in ('active', 'paused', 'done') and (select private.can_view_project(p.id))
  order by (p.status <> 'active'), p.code;
$$;
revoke all on function public.my_tool_check_projects() from public, anon;
grant execute on function public.my_tool_check_projects() to authenticated;
