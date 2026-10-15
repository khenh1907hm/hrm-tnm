-- Chuyển hàm vai trò sang schema `private` (không mở qua API) theo khuyến nghị linter 0029.
-- Policy tham chiếu hàm theo OID nên vẫn hoạt động sau khi đổi schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.app_role() set schema private;
revoke execute on function private.app_role() from public, anon;
grant execute on function private.app_role() to authenticated;

-- Chỉ mục cho khóa ngoại reminder_log.certificate_id (linter 0001)
create index if not exists reminder_log_certificate_id_idx on public.reminder_log (certificate_id);
