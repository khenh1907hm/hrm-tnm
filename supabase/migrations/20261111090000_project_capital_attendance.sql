-- Vốn dự án, quyền xem tiền mở thêm cho Chỉ huy trưởng, giờ làm + GPS công trường, tự chấm công bằng GPS và ảnh.
--
--  * Tiền (vốn, ngân sách, đơn giá riêng, tiền công, thầu phụ, phiếu chi): Admin, PM và CHT của dự án (private.is_project_lead).
--  * Nhân viên tự chấm Vào / Ra qua hàm check_in / check_out: máy chủ lấy giờ của máy chủ, tính khoảng cách tới công trường
--    và chặn nếu ngoài bán kính. Ảnh ở bucket riêng tư attendance-photos, đường dẫn <project_id>/<auth uid>/<ngày>-<in|out>.jpg.
--  * Tổ trưởng, CHT, PM xem lượt chấm công của dự án mình; nhân viên xem lượt của chính mình.

-- ───────────────────────── Vốn dự án ─────────────────────────
create table public.project_finance (
  project_id uuid primary key references public.projects (id) on delete cascade,
  capital bigint not null default 0 check (capital >= 0),
  note text not null default '',
  updated_at timestamptz not null default now()
);
comment on table public.project_finance is 'Vốn dự án (VNĐ). Vốn còn lại = vốn − chi phí đã duyệt. Chỉ Admin, PM, CHT.';
create trigger project_finance_touch before update on public.project_finance for each row execute function public.touch_updated_at();
alter table public.project_finance enable row level security;
create policy "project_finance: đọc ghi" on public.project_finance for all to authenticated
  using ((select private.is_project_lead(project_id))) with check ((select private.is_project_lead(project_id)));

-- ───────────────────────── Tiền: thêm Chỉ huy trưởng ─────────────────────────
drop policy "project_budgets: đọc" on public.project_budgets;
drop policy "project_budgets: ghi" on public.project_budgets;
create policy "project_budgets: đọc" on public.project_budgets for select to authenticated using ((select private.is_project_lead(project_id)));
create policy "project_budgets: ghi" on public.project_budgets for all to authenticated
  using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()))
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
drop policy "project_budget_changes: đọc" on public.project_budget_changes;
drop policy "project_budget_changes: thêm" on public.project_budget_changes;
create policy "project_budget_changes: đọc" on public.project_budget_changes for select to authenticated using ((select private.is_project_lead(project_id)));
create policy "project_budget_changes: thêm" on public.project_budget_changes for insert to authenticated
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
drop policy "subcontracts: ghi" on public.subcontracts;
create policy "subcontracts: ghi" on public.subcontracts for all to authenticated using ((select private.is_project_lead(project_id))) with check ((select private.is_project_lead(project_id)));
drop policy "subcontract_payments: đọc ghi" on public.subcontract_payments;
create policy "subcontract_payments: đọc ghi" on public.subcontract_payments for all to authenticated
  using (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.is_project_lead(s.project_id))))
  with check (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.is_project_lead(s.project_id))));
drop policy "project_member_rates: đọc ghi" on public.project_member_rates;
create policy "project_member_rates: đọc ghi" on public.project_member_rates for all to authenticated
  using (exists (select 1 from public.project_members m where m.id = member_id and (select private.is_project_lead(m.project_id))))
  with check (exists (select 1 from public.project_members m where m.id = member_id and (select private.is_project_lead(m.project_id))));
drop policy "timesheet_costs: đọc" on public.timesheet_costs;
create policy "timesheet_costs: đọc" on public.timesheet_costs for select to authenticated using ((select private.is_project_lead(project_id)));
drop policy "project_expenses: đọc ghi" on public.project_expenses;
create policy "project_expenses: đọc ghi" on public.project_expenses for all to authenticated
  using ((select private.is_project_lead(project_id))) with check ((select private.is_project_lead(project_id)));

-- ───────────────────────── Giờ làm và vị trí công trường ─────────────────────────
alter table public.projects
  add column site_lat double precision check (site_lat between -90 and 90),
  add column site_lng double precision check (site_lng between -180 and 180),
  add column site_radius_m integer not null default 300 check (site_radius_m between 50 and 5000),
  add column work_start time not null default '08:00',
  add column work_end time not null default '17:00',
  add column lunch_start time not null default '12:00',
  add column lunch_end time not null default '13:00',
  add constraint projects_work_hours_check check (work_end > work_start and lunch_end >= lunch_start),
  add constraint projects_site_pair_check check ((site_lat is null) = (site_lng is null));
comment on column public.projects.site_radius_m is 'Bán kính (mét) quanh tọa độ công trường được phép tự chấm công.';

-- ───────────────────────── Lượt chấm công GPS ─────────────────────────
create table public.attendance_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete restrict,
  user_id uuid not null default auth.uid(),
  work_date date not null,
  check_in_at timestamptz not null,
  in_lat double precision not null,
  in_lng double precision not null,
  in_accuracy_m real,
  in_distance_m integer not null,
  in_photo text not null,
  check_out_at timestamptz,
  out_lat double precision,
  out_lng double precision,
  out_accuracy_m real,
  out_distance_m integer,
  out_photo text,
  unique (project_id, employee_id, work_date),
  check (check_out_at is null or check_out_at > check_in_at)
);
create index attendance_checks_project_date_idx on public.attendance_checks (project_id, work_date);
create index attendance_checks_employee_idx on public.attendance_checks (employee_id, work_date);
comment on table public.attendance_checks is 'Tự chấm công Vào/Ra bằng GPS + ảnh. Chỉ ghi qua public.check_in / public.check_out.';
alter table public.attendance_checks enable row level security;
create policy "attendance_checks: đọc" on public.attendance_checks for select to authenticated using (
  employee_id = (select private.my_employee_id())
  or (select private.is_project_lead(project_id))
  or (select private.has_access('projects.view'))
  or exists (select 1 from public.project_members m where m.project_id = attendance_checks.project_id and m.employee_id = attendance_checks.employee_id and (select private.leads_team(m.project_id, m.team)))
);

-- Khoảng cách mặt đất (mét) theo công thức haversine.
create or replace function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::integer;
$$;

-- Dự án đang thi công mà người đang đăng nhập là thành viên (kể cả tổ viên), kèm giờ làm, tọa độ và lượt chấm hôm nay.
create or replace function public.my_attendance_context()
returns table (
  project_id uuid, code text, name text, team text, site_lat double precision, site_lng double precision, site_radius_m integer,
  work_start time, work_end time, lunch_start time, lunch_end time, weekly_off smallint[], std_hours numeric,
  check_id uuid, check_in_at timestamptz, check_out_at timestamptz, in_distance_m integer, out_distance_m integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.code, p.name, m.team, p.site_lat, p.site_lng, p.site_radius_m, p.work_start, p.work_end, p.lunch_start, p.lunch_end, p.weekly_off, p.std_hours,
    c.id, c.check_in_at, c.check_out_at, c.in_distance_m, c.out_distance_m
  from public.project_members m
  join public.projects p on p.id = m.project_id and p.status = 'active'
  left join public.attendance_checks c on c.project_id = p.id and c.employee_id = m.employee_id and c.work_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date
  where m.employee_id = (select private.my_employee_id())
    and m.joined_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
    and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  order by p.code;
$$;

create or replace function private.validate_position(p_project uuid, p_lat double precision, p_lng double precision, p_photo text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.projects;
  me text := (select private.my_employee_id());
  d integer;
begin
  if me is null then raise exception 'CHECKIN_NO_EMPLOYEE'; end if;
  select * into p from public.projects where id = p_project;
  if not found or p.status <> 'active' then raise exception 'TS_PROJECT_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.project_members m where m.project_id = p_project and m.employee_id = me
      and m.joined_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)) then
    raise exception 'TS_OUTSIDE_MEMBERSHIP';
  end if;
  if p.site_lat is null then raise exception 'CHECKIN_NO_SITE'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'CHECKIN_NO_GPS'; end if;
  if p_photo is null or p_photo not like p_project::text || '/' || auth.uid()::text || '/%' then raise exception 'CHECKIN_NO_PHOTO'; end if;
  d := private.distance_m(p.site_lat, p.site_lng, p_lat, p_lng);
  if d > p.site_radius_m then raise exception 'CHECKIN_OUT_OF_RANGE:%', d; end if;
  return d;
end;
$$;

create or replace function public.check_in(p_project uuid, p_lat double precision, p_lng double precision, p_accuracy real, p_photo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d integer := private.validate_position(p_project, p_lat, p_lng, p_photo);
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if exists (select 1 from public.attendance_checks where project_id = p_project and employee_id = (select private.my_employee_id()) and work_date = today) then
    raise exception 'CHECKIN_ALREADY';
  end if;
  insert into public.attendance_checks (project_id, employee_id, user_id, work_date, check_in_at, in_lat, in_lng, in_accuracy_m, in_distance_m, in_photo)
  values (p_project, (select private.my_employee_id()), auth.uid(), today, now(), p_lat, p_lng, p_accuracy, d, p_photo);
end;
$$;

create or replace function public.check_out(p_project uuid, p_lat double precision, p_lng double precision, p_accuracy real, p_photo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d integer := private.validate_position(p_project, p_lat, p_lng, p_photo);
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  update public.attendance_checks
    set check_out_at = now(), out_lat = p_lat, out_lng = p_lng, out_accuracy_m = p_accuracy, out_distance_m = d, out_photo = p_photo
    where project_id = p_project and employee_id = (select private.my_employee_id()) and work_date = today and check_out_at is null;
  if not found then raise exception 'CHECKOUT_WITHOUT_CHECKIN'; end if;
end;
$$;

revoke all on function private.distance_m(double precision, double precision, double precision, double precision), private.validate_position(uuid, double precision, double precision, text) from public, anon;
grant execute on function private.distance_m(double precision, double precision, double precision, double precision) to authenticated;
revoke all on function private.validate_position(uuid, double precision, double precision, text) from authenticated;
revoke all on function public.my_attendance_context(), public.check_in(uuid, double precision, double precision, real, text), public.check_out(uuid, double precision, double precision, real, text) from public, anon;
grant execute on function public.my_attendance_context(), public.check_in(uuid, double precision, double precision, real, text), public.check_out(uuid, double precision, double precision, real, text) to authenticated;

-- ───────────────────────── Ảnh chấm công ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-photos', 'attendance-photos', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create policy "attendance-photos: thêm ảnh của mình" on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-photos' and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.project_members m where m.project_id::text = (storage.foldername(name))[1] and m.employee_id = (select private.my_employee_id())));
create policy "attendance-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or (select private.has_access('projects.view'))
    or exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and (select private.is_project_lead(p.id)))
    or exists (select 1 from public.project_members m where m.project_id::text = (storage.foldername(name))[1] and (select private.leads_team(m.project_id, m.team)))
  ));
