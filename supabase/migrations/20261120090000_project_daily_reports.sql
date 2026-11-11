-- Báo cáo ngày của dự án (mẫu "BC ngày"): chỉ huy trưởng chụp bảng phân công + tối đa 4 ảnh thi công,
-- máy chủ đọc bảng (Python), điền mẫu Excel và gửi vào nhóm Telegram. CHỈ LƯU DỮ LIỆU, không lưu ảnh.
--  * Một dự án mỗi ngày một báo cáo (gửi lại thì ghi đè).
--  * Lũy kế công = tổng số người hiện diện các ngày tới hết ngày báo cáo; lũy kế giờ TC = tổng giờ tăng ca.

create table public.project_daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  report_date date not null,
  total integer check (total is null or total >= 0),
  present integer check (present is null or present >= 0),
  absent integer check (absent is null or absent >= 0),
  absent_names text[] not null default '{}',
  ot_count integer not null default 0 check (ot_count >= 0),
  ot_hours numeric(8, 2) not null default 0 check (ot_hours >= 0),
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array' and pg_column_size(tasks) < 200000),
  photo_count smallint not null default 0 check (photo_count between 0 and 4),
  read_model text not null default '',
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_error text not null default '',
  unique (project_id, report_date)
);
create index project_daily_reports_project_idx on public.project_daily_reports (project_id, report_date desc);
comment on table public.project_daily_reports is 'Báo cáo ngày (BC ngày) của dự án: số người, người vắng, tăng ca, phân công. Không lưu ảnh.';
create trigger project_daily_reports_touch before update on public.project_daily_reports for each row execute function public.touch_updated_at();

alter table public.project_daily_reports enable row level security;
create policy "project_daily_reports: đọc" on public.project_daily_reports for select to authenticated using ((select private.can_view_project(project_id)));

-- Ai được lập / gửi báo cáo ngày: PM, Chỉ huy trưởng của dự án, hoặc quyền quản lý dự án.
create or replace function public.daily_report_can_send(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_project_lead(p_project)) or (select private.can_manage_projects());
$$;

-- Lưu (ghi đè theo ngày) và trả về lũy kế để điền mẫu.
create or replace function public.daily_report_save(p_project uuid, p_date date, p_total integer, p_present integer, p_absent integer,
  p_absent_names text[], p_ot_count integer, p_ot_hours numeric, p_tasks jsonb, p_photo_count integer, p_model text)
returns table (id uuid, project_code text, project_name text, cumulative_workdays bigint, cumulative_ot_hours numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare rid uuid;
begin
  if not (select public.daily_report_can_send(p_project)) then raise exception 'FORBIDDEN'; end if;
  if p_date is null then raise exception 'DR_DATE_REQUIRED'; end if;
  if p_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1 then raise exception 'TS_FUTURE_DATE'; end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_tasks, '[]'::jsonb)) = 0 then raise exception 'DR_TASKS_REQUIRED'; end if;
  insert into public.project_daily_reports (project_id, report_date, total, present, absent, absent_names, ot_count, ot_hours, tasks, photo_count, read_model, created_by_name)
  values (p_project, p_date, p_total, p_present, p_absent, coalesce(p_absent_names, '{}'), coalesce(p_ot_count, 0), coalesce(p_ot_hours, 0), p_tasks,
    least(greatest(coalesce(p_photo_count, 0), 0), 4), coalesce(p_model, ''), coalesce((select full_name from public.profiles where id = auth.uid()), ''))
  on conflict (project_id, report_date) do update set
    total = excluded.total, present = excluded.present, absent = excluded.absent, absent_names = excluded.absent_names,
    ot_count = excluded.ot_count, ot_hours = excluded.ot_hours, tasks = excluded.tasks, photo_count = excluded.photo_count,
    read_model = excluded.read_model, created_by = auth.uid(), created_by_name = excluded.created_by_name, sent_at = null, sent_error = ''
  returning project_daily_reports.id into rid;
  return query
    select rid, p.code, p.name,
      (select coalesce(sum(r.present), 0) from public.project_daily_reports r where r.project_id = p_project and r.report_date <= p_date)::bigint,
      (select coalesce(sum(r.ot_hours), 0) from public.project_daily_reports r where r.project_id = p_project and r.report_date <= p_date)
    from public.projects p where p.id = p_project;
end;
$$;

-- Ghi kết quả gửi Telegram.
create or replace function public.daily_report_mark_sent(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pid uuid;
begin
  select project_id into pid from public.project_daily_reports where id = p_id;
  if pid is null or not (select public.daily_report_can_send(pid)) then raise exception 'FORBIDDEN'; end if;
  update public.project_daily_reports set sent_at = case when coalesce(btrim(p_error), '') = '' then now() end, sent_error = coalesce(btrim(p_error), '') where id = p_id;
end;
$$;

revoke all on function public.daily_report_can_send(uuid), public.daily_report_save(uuid, date, integer, integer, integer, text[], integer, numeric, jsonb, integer, text),
  public.daily_report_mark_sent(uuid, text) from public, anon;
grant execute on function public.daily_report_can_send(uuid), public.daily_report_save(uuid, date, integer, integer, integer, text[], integer, numeric, jsonb, integer, text),
  public.daily_report_mark_sent(uuid, text) to authenticated;
