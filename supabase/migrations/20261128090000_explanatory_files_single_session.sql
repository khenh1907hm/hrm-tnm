-- Attach file cho báo cáo giải thích (P-COST-05, tab Ngân sách) và đăng nhập một nơi, tối đa 24 giờ.
--  * explanatory_attachments: tệp bằng chứng (yêu cầu khách, báo giá vượt, báo cáo sự cố, bản vẽ giải thích), kho project-files
--    (đường dẫn <id báo cáo>/<tệp>); cờ attachments của báo cáo tự cập nhật theo tệp.
--  * user_sessions: mỗi tài khoản một phiên đang dùng (session_key do trình duyệt tạo khi đăng nhập).
--    Đăng nhập nơi mới thì phiên cũ nhận "replaced" và tự đăng xuất; quá 24 giờ kể từ lúc đăng nhập thì "expired".

-- ───────────────────────── Tệp báo cáo giải thích ─────────────────────────
create table if not exists public.explanatory_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.explanatory_reports (id) on delete cascade,
  kind text not null check (kind in ('customerRequest', 'overQuote', 'incident', 'drawing')),
  path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists explanatory_attachments_report_idx on public.explanatory_attachments (report_id);
alter table public.explanatory_attachments enable row level security;

create or replace function private.can_view_explanatory(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.explanatory_reports r where r.id = p_report and (select private.can_see_budget(r.project_id)));
$$;
grant execute on function private.can_view_explanatory(uuid) to authenticated;

create or replace function private.can_view_project_file(p_parent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_parent is not null and ((select private.can_view_contract(p_parent)) or (select private.can_view_explanatory(p_parent)));
$$;
grant execute on function private.can_view_project_file(uuid) to authenticated;

drop policy if exists "explanatory_attachments: đọc" on public.explanatory_attachments;
create policy "explanatory_attachments: đọc" on public.explanatory_attachments for select to authenticated using ((select private.can_view_explanatory(report_id)));
drop policy if exists "explanatory_attachments: thêm" on public.explanatory_attachments;
create policy "explanatory_attachments: thêm" on public.explanatory_attachments for insert to authenticated
  with check ((select private.can_view_explanatory(report_id)) and uploaded_by = (select auth.uid()));
drop policy if exists "explanatory_attachments: xóa" on public.explanatory_attachments;
create policy "explanatory_attachments: xóa" on public.explanatory_attachments for delete to authenticated
  using ((select private.can_view_explanatory(report_id)) and (uploaded_by = (select auth.uid()) or (select private.is_admin())));

drop policy if exists "project-files: đọc" on storage.objects;
create policy "project-files: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (select private.can_view_project_file(private.purchase_file_order(name))));
drop policy if exists "project-files: thêm" on storage.objects;
create policy "project-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (select private.can_view_project_file(private.purchase_file_order(name))));
drop policy if exists "project-files: xóa" on storage.objects;
create policy "project-files: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (select private.can_view_project_file(private.purchase_file_order(name))));

create or replace function private.explanatory_attachment_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.report_id, old.report_id);
  k text := coalesce(new.kind, old.kind);
begin
  update public.explanatory_reports
  set attachments = coalesce(attachments, '{}'::jsonb) || jsonb_build_object(k, exists (select 1 from public.explanatory_attachments a where a.report_id = rid and a.kind = k))
  where id = rid;
  return null;
end;
$$;
drop trigger if exists explanatory_attachment_flags on public.explanatory_attachments;
create trigger explanatory_attachment_flags after insert or delete on public.explanatory_attachments
  for each row execute function private.explanatory_attachment_flags();

-- ───────────────────────── Một nơi đăng nhập, tối đa 24 giờ ─────────────────────────
create table if not exists public.user_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  session_key text not null,
  started_at timestamptz not null default now(),
  user_agent text not null default ''
);
comment on table public.user_sessions is 'Phiên đăng nhập đang dùng của mỗi tài khoản (đăng nhập nơi khác thì phiên cũ bị đẩy ra; quá 24 giờ phải đăng nhập lại).';
alter table public.user_sessions enable row level security;
drop policy if exists "user_sessions: của mình" on public.user_sessions;
create policy "user_sessions: của mình" on public.user_sessions for select to authenticated using (user_id = (select auth.uid()));

-- Vừa đăng nhập: phiên này thành phiên duy nhất, tính lại 24 giờ.
create or replace function public.session_claim(p_key text, p_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or char_length(coalesce(p_key, '')) < 16 then raise exception 'FORBIDDEN'; end if;
  insert into public.user_sessions (user_id, session_key, started_at, user_agent) values (auth.uid(), p_key, now(), left(coalesce(p_agent, ''), 300))
  on conflict (user_id) do update set session_key = excluded.session_key, started_at = now(), user_agent = excluded.user_agent;
end;
$$;

-- Kiểm tra phiên: ok | replaced (đã đăng nhập nơi khác) | expired (quá 24 giờ) | none (chưa nhận phiên).
create or replace function public.session_check(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.user_id is null then 'none'
    when s.session_key <> coalesce(p_key, '') then 'replaced'
    when s.started_at < now() - interval '24 hours' then 'expired'
    else 'ok' end
  from (select auth.uid() as uid) me left join public.user_sessions s on s.user_id = me.uid;
$$;

revoke all on function public.session_claim(text, text), public.session_check(text) from public, anon;
grant execute on function public.session_claim(text, text), public.session_check(text) to authenticated;
