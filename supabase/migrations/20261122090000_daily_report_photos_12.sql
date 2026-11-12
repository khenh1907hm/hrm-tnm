-- Báo cáo ngày: ảnh thi công không bắt buộc, tối đa 12 ảnh (6 hàng khung × 2) thay vì cố định 4.
-- Tên người vắng không còn đọc từ ảnh nữa (chỉ đọc số TS / HD / V); cột absent_names giữ lại cho báo cáo cũ.
-- Sửa lỗi "column reference id is ambiguous": hàm trả về cột id nên phải ghi rõ profiles.id khi lấy tên người gửi.

alter table public.project_daily_reports drop constraint if exists project_daily_reports_photo_count_check;
alter table public.project_daily_reports add constraint project_daily_reports_photo_count_check check (photo_count between 0 and 12);

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
    least(greatest(coalesce(p_photo_count, 0), 0), 12), coalesce(p_model, ''), coalesce((select pr.full_name from public.profiles pr where pr.id = auth.uid()), ''))
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
