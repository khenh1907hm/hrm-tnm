-- Báo lỗi / góp ý: mọi tài khoản gửi từ nút tài khoản góc phải (kèm trang đang mở, ảnh chụp màn hình nếu có);
-- Admin nhận thông báo (chuông + email) và xử lý ở trang "Báo lỗi".
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reporter_name text not null default '',
  reporter_email text not null default '',
  page_url text not null default '',
  message text not null check (char_length(btrim(message)) between 3 and 4000),
  screenshot_path text not null default '',
  user_agent text not null default '',
  status text not null default 'open' check (status in ('open', 'done')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);
alter table public.bug_reports enable row level security;

drop policy if exists "bug_reports: gửi" on public.bug_reports;
create policy "bug_reports: gửi" on public.bug_reports for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "bug_reports: đọc" on public.bug_reports;
create policy "bug_reports: đọc" on public.bug_reports for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
drop policy if exists "bug_reports: sửa" on public.bug_reports;
-- Người gửi chỉ gắn ảnh chụp vào báo cáo của mình; Admin đổi trạng thái, ghi chú
create policy "bug_reports: sửa" on public.bug_reports for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin())) with check (user_id = (select auth.uid()) or (select private.is_admin()));

-- Người gửi không tự đổi trạng thái; điền tên, email người gửi
create or replace function private.bug_report_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.admin_note := '';
    new.resolved_at := null;
    new.reporter_name := coalesce(nullif((select full_name from public.profiles where id = new.user_id), ''),
      (select coalesce(e.doc ->> 'name', e.code) from public.profiles pr join public.employees e on e.id = pr.employee_id where pr.id = new.user_id), '');
    new.reporter_email := coalesce((select email from auth.users where id = new.user_id), '');
  elsif not (select private.is_admin()) then
    new.status := old.status; new.admin_note := old.admin_note; new.resolved_at := old.resolved_at; new.message := old.message;
  elsif new.status = 'done' and old.status <> 'done' then
    new.resolved_at := now();
  elsif new.status = 'open' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists bug_report_guard on public.bug_reports;
create trigger bug_report_guard before insert or update on public.bug_reports for each row execute function private.bug_report_guard();

-- Báo cho Admin (chuông + email)
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind in ('approval_pending', 'approval_returned', 'approval_approved', 'bug_report'));

create or replace function private.bug_report_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_notifications (user_id, kind, step_id, title, body, link)
  select p.id, 'bug_report', new.id, 'Báo lỗi mới từ ' || coalesce(nullif(new.reporter_name, ''), new.reporter_email, 'người dùng'),
    left(new.message, 300) || case when new.page_url <> '' then ' · Trang: ' || new.page_url else '' end, '/bao-loi'
  from public.profiles p where p.role = 'admin' and p.id <> new.user_id
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists bug_report_notify on public.bug_reports;
create trigger bug_report_notify after insert on public.bug_reports for each row execute function private.bug_report_notify();

-- Ảnh chụp màn hình: kho riêng bug-files, đường dẫn <id báo cáo>/<tệp>
insert into storage.buckets (id, name, public, file_size_limit) values ('bug-files', 'bug-files', false, 10485760)
on conflict (id) do nothing;

create or replace function private.can_view_bug(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_report is not null and exists (select 1 from public.bug_reports b where b.id = p_report and (b.user_id = (select auth.uid()) or (select private.is_admin())));
$$;
grant execute on function private.can_view_bug(uuid) to authenticated;

drop policy if exists "bug-files: đọc" on storage.objects;
create policy "bug-files: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'bug-files' and (select private.can_view_bug(private.purchase_file_order(name))));
drop policy if exists "bug-files: thêm" on storage.objects;
create policy "bug-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-files' and (select private.can_view_bug(private.purchase_file_order(name))));
