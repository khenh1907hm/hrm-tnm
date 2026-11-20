-- Chấm công tự do: nhân viên (tài khoản đã liên kết hồ sơ nhân sự) chấm Vào / Ra được ở MỌI công trường đang thi công,
-- không cần là thành viên dự án. Vẫn bắt buộc: dự án đang thi công, có vị trí công trường, GPS trong bán kính, ảnh chụp tại chỗ.
-- Giờ vẫn do máy chủ ghi. Chỉ huy trưởng / PM của công trường thấy lượt chấm như cũ (theo project_id).

-- 1) Bỏ điều kiện thành viên khi kiểm tra vị trí
create or replace function private.validate_position(p_project uuid, p_lat double precision, p_lng double precision, p_photo text)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  p public.projects;
  me text := (select private.my_employee_id());
  d integer;
begin
  if me is null then raise exception 'CHECKIN_NO_EMPLOYEE'; end if;
  select * into p from public.projects where id = p_project;
  if not found or p.status <> 'active' then raise exception 'TS_PROJECT_NOT_ACTIVE'; end if;
  if p.site_lat is null then raise exception 'CHECKIN_NO_SITE'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'CHECKIN_NO_GPS'; end if;
  if p_photo is null or p_photo not like p_project::text || '/' || auth.uid()::text || '/%' then raise exception 'CHECKIN_NO_PHOTO'; end if;
  d := private.distance_m(p.site_lat, p.site_lng, p_lat, p_lng);
  if d > p.site_radius_m then raise exception 'CHECKIN_OUT_OF_RANGE:%', d; end if;
  return d;
end;
$$;

-- 2) Ảnh chấm công: tải lên được cho mọi dự án đang thi công (thư mục <dự án>/<chính mình>/...)
drop policy if exists "attendance-photos: thêm ảnh của mình" on storage.objects;
create policy "attendance-photos: thêm ảnh của mình" on storage.objects for insert to authenticated
with check (
  bucket_id = 'attendance-photos'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.my_employee_id()) is not null
  and exists (select 1 from public.projects p where p.id::text = (storage.foldername(objects.name))[1] and p.status = 'active')
);

-- 3) Danh sách công trường cho app: đủ thông tin để chấm (vị trí, giờ làm, lượt chấm hôm nay của mình)
drop function if exists public.attendance_sites();
create function public.attendance_sites()
returns table (
  project_id uuid, code text, name text, site text, site_lat double precision, site_lng double precision, site_radius_m integer,
  work_start time, work_end time, is_member boolean, team text,
  check_in_at timestamptz, check_out_at timestamptz, in_distance_m integer, out_distance_m integer
)
language sql stable security definer set search_path = ''
as $$
  with me as (select private.my_employee_id() as id, (now() at time zone 'Asia/Ho_Chi_Minh')::date as today)
  select p.id, p.code, p.name, coalesce(p.site, ''), p.site_lat, p.site_lng, p.site_radius_m, p.work_start, p.work_end,
    m.id is not null, coalesce(m.team, ''),
    c.check_in_at, c.check_out_at, c.in_distance_m, c.out_distance_m
  from public.projects p
  cross join me
  left join lateral (
    select pm.id, pm.team from public.project_members pm
    where pm.project_id = p.id and pm.employee_id = me.id and pm.joined_on <= me.today and (pm.left_on is null or pm.left_on >= me.today)
    limit 1
  ) m on true
  left join public.attendance_checks c on c.project_id = p.id and c.employee_id = me.id and c.work_date = me.today
  where p.status = 'active'
  order by (m.id is null), p.code;
$$;

revoke all on function public.attendance_sites() from public, anon;
grant execute on function public.attendance_sites() to authenticated;
