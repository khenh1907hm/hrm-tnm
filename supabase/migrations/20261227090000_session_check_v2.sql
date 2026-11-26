-- Đăng nhập một nơi: máy bị thay phiên trước đây gọi /logout bằng phiên đã bị thu hồi, khiến Supabase
-- đăng xuất MỌI phiên của tài khoản (kể cả phiên vừa đăng nhập). Bản mới chỉ xóa phiên ở máy mình và gọi session_check(p_key, p_v).
-- Bản cũ còn mở (gọi session_check(p_key)) không nhận "replaced" nữa: phiên đã bị thu hồi nên tự hết khi làm mới token.
create or replace function public.session_check(p_key text, p_v integer)
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
revoke all on function public.session_check(text, integer) from public, anon;
grant execute on function public.session_check(text, integer) to authenticated;

create or replace function public.session_check(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.user_id is null then 'none'
    when s.session_key <> coalesce(p_key, '') then 'ok'
    when s.started_at < now() - interval '24 hours' then 'ok'
    else 'ok' end
  from (select auth.uid() as uid) me left join public.user_sessions s on s.user_id = me.uid;
$$;

-- Không cho phiên đã bị thu hồi (token cũ còn hạn) nhận lại quyền "phiên chính"
create or replace function public.session_claim(p_key text, p_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or char_length(coalesce(p_key, '')) < 16 then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from auth.sessions a where a.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and a.user_id = auth.uid()) then raise exception 'SESSION_REVOKED'; end if;
  insert into public.user_sessions (user_id, session_key, started_at, user_agent) values (auth.uid(), p_key, now(), left(coalesce(p_agent, ''), 300))
  on conflict (user_id) do update set session_key = excluded.session_key, started_at = now(), user_agent = excluded.user_agent;
end;
$$;
