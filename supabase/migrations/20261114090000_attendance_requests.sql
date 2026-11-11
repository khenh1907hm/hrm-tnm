-- Lịch chấm công theo tháng của nhân viên và Phiếu giải trình chấm công.
--  * my_attendance_month(tháng): nhân viên xem từng ngày của chính mình (giờ Vào/Ra GPS, phiếu công của tổ: trạng thái, giờ thường, tăng ca).
--  * attendance_requests: nhân viên gửi giải trình (quên chấm, sai giờ, ngoài công trường…) cho PM của dự án.
--    PM của dự án (hoặc Admin) duyệt / từ chối; sếp (Admin, người phê duyệt đơn hàng, quyền xem dự án), CHT xem được.
--    Duyệt kèm giờ đề nghị thì ghi bù vào attendance_checks (nguồn = giải trình), phiếu công của tổ tự điền theo đó.

-- Lượt chấm công ghi bù từ giải trình không có GPS/ảnh
alter table public.attendance_checks
  alter column in_lat drop not null,
  alter column in_lng drop not null,
  alter column in_distance_m drop not null,
  alter column in_photo drop not null,
  add column source text not null default 'gps' check (source in ('gps', 'explanation')),
  add constraint attendance_checks_gps_fields check (source <> 'gps' or (in_lat is not null and in_lng is not null and in_distance_m is not null and in_photo is not null));

create table public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete restrict,
  employee_name text not null default '',
  user_id uuid not null default auth.uid(),
  work_date date not null,
  kind text not null check (kind in ('missing_in', 'missing_out', 'wrong_time', 'out_of_range', 'other')),
  requested_in time,
  requested_out time,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id uuid,
  reviewer_name text not null default '',
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  check (requested_out is null or requested_in is null or requested_out > requested_in)
);
create index attendance_requests_project_idx on public.attendance_requests (project_id, status, work_date);
create index attendance_requests_employee_idx on public.attendance_requests (employee_id, work_date);
create unique index attendance_requests_one_pending on public.attendance_requests (project_id, employee_id, work_date) where status = 'pending';
comment on table public.attendance_requests is 'Phiếu giải trình chấm công: nhân viên gửi, PM của dự án duyệt. Chỉ ghi qua các hàm attendance_request_*.';

alter table public.attendance_checks add column request_id uuid references public.attendance_requests (id) on delete set null;
create index attendance_checks_request_idx on public.attendance_checks (request_id);

-- Sếp xem mọi giải trình: Admin, người phê duyệt (danh sách đặt hàng), quyền xem dự án
create or replace function private.is_boss()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.is_purchase_approver()) or (select private.has_access('projects.view'));
$$;
revoke all on function private.is_boss() from public, anon;
grant execute on function private.is_boss() to authenticated;

alter table public.attendance_requests enable row level security;
create policy "attendance_requests: đọc" on public.attendance_requests for select to authenticated using (
  employee_id = (select private.my_employee_id())
  or (select private.is_project_lead(project_id))
  or (select private.is_boss())
);

-- Gửi giải trình: thành viên của dự án, ngày không ở tương lai, trong 45 ngày gần đây, tháng chưa khóa sổ.
create or replace function public.attendance_request_submit(p_project uuid, p_date date, p_kind text, p_in time, p_out time, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select private.my_employee_id());
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  rid uuid;
begin
  if me is null then raise exception 'CHECKIN_NO_EMPLOYEE'; end if;
  if not exists (select 1 from public.project_members m where m.project_id = p_project and m.employee_id = me
      and m.joined_on <= p_date and (m.left_on is null or m.left_on >= p_date)) then raise exception 'TS_OUTSIDE_MEMBERSHIP'; end if;
  if p_date > today then raise exception 'TS_FUTURE_DATE'; end if;
  if p_date < today - 45 then raise exception 'ATR_TOO_OLD'; end if;
  if (select private.is_locked(p_project, p_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'ATR_REASON_REQUIRED'; end if;
  if p_kind in ('missing_in', 'wrong_time') and p_in is null then raise exception 'ATR_TIME_REQUIRED'; end if;
  if p_kind in ('missing_out', 'wrong_time') and p_out is null then raise exception 'ATR_TIME_REQUIRED'; end if;
  if p_in is not null and p_out is not null and p_out <= p_in then raise exception 'ATR_TIME_ORDER'; end if;
  if exists (select 1 from public.attendance_requests where project_id = p_project and employee_id = me and work_date = p_date and status = 'pending') then raise exception 'ATR_PENDING_EXISTS'; end if;
  insert into public.attendance_requests (project_id, employee_id, employee_name, work_date, kind, requested_in, requested_out, reason)
  values (p_project, me, coalesce((select doc ->> 'name' from public.employees where id = me), ''), p_date, p_kind, p_in, p_out, btrim(p_reason))
  returning id into rid;
  return rid;
end;
$$;

-- PM của dự án (hoặc Admin) duyệt / từ chối. Duyệt kèm giờ thì ghi bù lượt chấm công của ngày đó.
create or replace function public.attendance_request_review(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.attendance_requests;
  c public.attendance_checks;
  v_in timestamptz;
  v_out timestamptz;
begin
  select * into r from public.attendance_requests where id = p_id for update;
  if not found then raise exception 'ATR_NOT_FOUND'; end if;
  if not (select private.is_project_pm(r.project_id)) then raise exception 'ATR_NOT_REVIEWER'; end if;
  if r.status <> 'pending' then raise exception 'ATR_NOT_PENDING'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'ATR_REVIEW_NOTE'; end if;
  if p_approve and (select private.is_locked(r.project_id, r.work_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;
  update public.attendance_requests set status = case when p_approve then 'approved' else 'rejected' end,
    reviewer_id = auth.uid(), reviewer_name = coalesce((select full_name from public.profiles where id = auth.uid()), ''), reviewed_at = now(), review_note = btrim(coalesce(p_note, ''))
    where id = p_id;
  if p_approve and (r.requested_in is not null or r.requested_out is not null) then
    v_in := case when r.requested_in is not null then (r.work_date + r.requested_in) at time zone 'Asia/Ho_Chi_Minh' end;
    v_out := case when r.requested_out is not null then (r.work_date + r.requested_out) at time zone 'Asia/Ho_Chi_Minh' end;
    select * into c from public.attendance_checks where project_id = r.project_id and employee_id = r.employee_id and work_date = r.work_date for update;
    if found then
      update public.attendance_checks set
        check_in_at = coalesce(v_in, check_in_at),
        check_out_at = case when v_out is not null and v_out > coalesce(v_in, check_in_at) then v_out else check_out_at end,
        request_id = p_id
        where id = c.id;
    elsif v_in is not null then
      insert into public.attendance_checks (project_id, employee_id, user_id, work_date, check_in_at, check_out_at, source, request_id)
      values (r.project_id, r.employee_id, r.user_id, r.work_date, v_in, case when v_out > v_in then v_out end, 'explanation', p_id);
    end if;
  end if;
  perform private.log_event(case when p_approve then 'attendance.request.approve' else 'attendance.request.reject' end, 'attendance_request', p_id::text,
    jsonb_build_object('employeeId', r.employee_id, 'workDate', r.work_date, 'note', btrim(coalesce(p_note, ''))));
end;
$$;

create or replace function public.attendance_request_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_requests set status = 'cancelled' where id = p_id and status = 'pending' and employee_id = (select private.my_employee_id());
  if not found then raise exception 'ATR_NOT_PENDING'; end if;
end;
$$;

-- Lịch tháng của chính mình: lượt chấm (GPS hoặc ghi bù) và dòng công trên phiếu của tổ.
create or replace function public.my_attendance_month(p_month text)
returns table (
  work_date date, project_id uuid, code text, project_name text,
  check_in_at timestamptz, check_out_at timestamptz, source text,
  sheet_status text, attendance text, regular_hours numeric, ot_hours numeric,
  work_start time, work_end time, lunch_start time, lunch_end time, std_hours numeric, weekly_off smallint[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select private.my_employee_id()) as id),
  days as (
    select c.work_date, c.project_id from public.attendance_checks c, me where c.employee_id = me.id and to_char(c.work_date, 'YYYY-MM') = p_month
    union
    select t.work_date, t.project_id from public.timesheet_lines l join public.timesheets t on t.id = l.timesheet_id, me
      where l.employee_id = me.id and to_char(t.work_date, 'YYYY-MM') = p_month and t.status <> 'draft'
  )
  select d.work_date, d.project_id, p.code, p.name, c.check_in_at, c.check_out_at, c.source,
    t.status, l.attendance, l.regular_hours, l.ot_hours, p.work_start, p.work_end, p.lunch_start, p.lunch_end, p.std_hours, p.weekly_off
  from days d
  cross join me
  join public.projects p on p.id = d.project_id
  left join public.attendance_checks c on c.project_id = d.project_id and c.employee_id = me.id and c.work_date = d.work_date
  left join lateral (
    select t2.* from public.timesheets t2 join public.timesheet_lines l2 on l2.timesheet_id = t2.id
    where t2.project_id = d.project_id and t2.work_date = d.work_date and l2.employee_id = me.id and t2.status <> 'draft' limit 1
  ) t on true
  left join public.timesheet_lines l on l.timesheet_id = t.id and l.employee_id = me.id
  order by d.work_date, p.code;
$$;

revoke all on function public.attendance_request_submit(uuid, date, text, time, time, text), public.attendance_request_review(uuid, boolean, text),
  public.attendance_request_cancel(uuid), public.my_attendance_month(text) from public, anon;
grant execute on function public.attendance_request_submit(uuid, date, text, time, time, text), public.attendance_request_review(uuid, boolean, text),
  public.attendance_request_cancel(uuid), public.my_attendance_month(text) to authenticated;
