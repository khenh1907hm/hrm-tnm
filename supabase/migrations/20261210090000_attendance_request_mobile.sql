-- Giải trình chấm công từ app điện thoại (dùng chung bảng attendance_requests với web, PM của dự án duyệt như cũ):
--  * reason_code: lý do chọn sẵn — quên chấm, làm việc công ty ở ngoài, không chấm công được, chọn sai ca, lý do khác.
--  * attachments: ảnh đính kèm (tối đa 3) ở kho riêng tư attendance-attachments, đường dẫn <dự án>/<auth uid>/<tên file>.
--  * attendance_request_submit_mobile: gửi một hoạt động Vào hoặc Ra kèm giờ đề nghị. Nơi làm việc là dự án đang thi công
--    (chấm tự do như app), dự án mình là thành viên ngày đó, hoặc dự án đã chấm ngày đó.
-- Tạo lại theo tên (if not exists / drop if exists) nên chạy lại nhiều lần vẫn ra cùng kết quả.

alter table public.attendance_requests
  add column if not exists reason_code text check (reason_code in ('forgot', 'outside_work', 'cannot_check', 'wrong_shift', 'other')),
  add column if not exists attachments text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-attachments', 'attendance-attachments', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "attendance-attachments: thêm của mình" on storage.objects;
create policy "attendance-attachments: thêm của mình" on storage.objects for insert to authenticated
with check (
  bucket_id = 'attendance-attachments'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (select private.my_employee_id()) is not null
);

drop policy if exists "attendance-attachments: đọc" on storage.objects;
create policy "attendance-attachments: đọc" on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-attachments' and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or (select private.is_boss())
    or exists (select 1 from public.projects p where p.id::text = (storage.foldername(objects.name))[1] and (select private.is_project_lead(p.id)))
  )
);

create or replace function public.attendance_request_submit_mobile(
  p_project uuid, p_date date, p_activity text, p_time time, p_reason_code text, p_note text, p_attachments text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select private.my_employee_id());
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  note text := btrim(coalesce(p_note, ''));
  files text[] := coalesce(p_attachments, '{}');
  label text;
  full_reason text;
  rid uuid;
  existing public.attendance_checks;
begin
  if me is null then raise exception 'CHECKIN_NO_EMPLOYEE'; end if;
  if p_activity is null or p_activity not in ('in', 'out') then raise exception 'ATR_ACTIVITY_REQUIRED'; end if;
  if p_time is null then raise exception 'ATR_TIME_REQUIRED'; end if;
  label := case p_reason_code
    when 'forgot' then 'Quên chấm công'
    when 'outside_work' then 'Làm việc công ty ở ngoài'
    when 'cannot_check' then 'Không chấm công được'
    when 'wrong_shift' then 'Chọn sai ca'
    when 'other' then 'Lý do khác'
  end;
  if label is null then raise exception 'ATR_REASON_REQUIRED'; end if;
  if p_reason_code = 'other' and char_length(note) < 5 then raise exception 'ATR_NOTE_REQUIRED'; end if;
  if char_length(note) > 900 then raise exception 'ATR_NOTE_TOO_LONG'; end if;

  if not exists (
    select 1 from public.projects p where p.id = p_project and (
      p.status = 'active'
      or exists (select 1 from public.project_members m where m.project_id = p.id and m.employee_id = me and m.joined_on <= p_date and (m.left_on is null or m.left_on >= p_date))
      or exists (select 1 from public.attendance_checks c where c.project_id = p.id and c.employee_id = me and c.work_date = p_date)
    )
  ) then raise exception 'TS_PROJECT_NOT_ACTIVE'; end if;

  if p_date > today then raise exception 'TS_FUTURE_DATE'; end if;
  if p_date < today - 45 then raise exception 'ATR_TOO_OLD'; end if;
  if (select private.is_locked(p_project, p_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;

  if cardinality(files) > 3 or exists (
    select 1 from unnest(files) f where f not like p_project::text || '/' || auth.uid()::text || '/%'
  ) then raise exception 'ATR_ATTACHMENT_INVALID'; end if;

  -- Giờ Ra đề nghị phải sau giờ Vào đã chấm (và ngược lại)
  select * into existing from public.attendance_checks c where c.project_id = p_project and c.employee_id = me and c.work_date = p_date;
  if found then
    if p_activity = 'out' and existing.check_in_at is not null and (p_date + p_time) at time zone 'Asia/Ho_Chi_Minh' <= existing.check_in_at then raise exception 'ATR_TIME_ORDER'; end if;
    if p_activity = 'in' and existing.check_out_at is not null and (p_date + p_time) at time zone 'Asia/Ho_Chi_Minh' >= existing.check_out_at then raise exception 'ATR_TIME_ORDER'; end if;
  end if;

  if exists (select 1 from public.attendance_requests where project_id = p_project and employee_id = me and work_date = p_date and status = 'pending') then
    raise exception 'ATR_PENDING_EXISTS';
  end if;

  full_reason := label || case when note <> '' then ': ' || note else '' end
    || case when cardinality(files) > 0 then ' (kèm ' || cardinality(files) || ' ảnh)' else '' end;

  insert into public.attendance_requests (project_id, employee_id, employee_name, work_date, kind, requested_in, requested_out, reason, reason_code, attachments)
  values (
    p_project, me, coalesce((select doc ->> 'name' from public.employees where id = me), ''), p_date,
    case p_activity when 'in' then 'missing_in' else 'missing_out' end,
    case when p_activity = 'in' then p_time end,
    case when p_activity = 'out' then p_time end,
    full_reason, p_reason_code, files
  )
  returning id into rid;
  return rid;
end;
$$;

revoke all on function public.attendance_request_submit_mobile(uuid, date, text, time, text, text, text[]) from public, anon;
grant execute on function public.attendance_request_submit_mobile(uuid, date, text, time, text, text, text[]) to authenticated;
