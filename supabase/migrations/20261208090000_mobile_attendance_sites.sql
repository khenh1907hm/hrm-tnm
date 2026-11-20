-- App điện thoại: danh sách công trường (dự án đang thi công) để chọn khi điểm danh.
-- Trả mọi dự án đang thi công kèm cờ is_member: chỉ thành viên đang làm ở dự án mới chấm công được
-- (check_in / check_out vẫn kiểm tra như cũ), người khác thấy để biết mình chưa được thêm vào công trường nào.
-- Chỉ đọc, không đổi bảng.

create or replace function public.attendance_sites()
returns table (project_id uuid, code text, name text, site text, has_site boolean, site_radius_m integer, is_member boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.name, coalesce(p.site, ''), p.site_lat is not null and p.site_lng is not null, p.site_radius_m,
    exists (
      select 1 from public.project_members m
      where m.project_id = p.id and m.employee_id = (select private.my_employee_id())
        and m.joined_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
        and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
    )
  from public.projects p
  where p.status = 'active'
  order by p.code;
$$;

revoke all on function public.attendance_sites() from public, anon;
grant execute on function public.attendance_sites() to authenticated;
