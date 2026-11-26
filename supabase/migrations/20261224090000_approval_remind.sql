-- Nhắc ký gấp: người lập phiếu / thành viên dự án / Admin / Giám đốc bấm "Nhắc" ở bước đang chờ ký
-- → thông báo (chuông + email) tới người đang đến lượt ký. Mỗi bước nhắc tối đa 1 lần / 30 phút.

alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind = any (array[
  'approval_pending', 'approval_returned', 'approval_approved', 'approval_reminder', 'bug_report', 'delivery_due', 'inspection_assigned', 'inspection_fixed', 'inspection_closed'
]));

create or replace function public.approval_remind(p_step uuid, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.approval_steps;
  first_pending uuid;
  label text;
  role_label text;
  pcode text;
  sender text;
  sent integer;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select * into cur from public.approval_steps where id = p_step;
  if cur.id is null or cur.result <> 'pending' then raise exception 'REMIND_NOT_PENDING'; end if;
  if exists (select 1 from public.approval_steps r where r.doc_type = cur.doc_type and r.doc_id = cur.doc_id and r.result = 'returned') then raise exception 'REMIND_NOT_PENDING'; end if;
  select s.id into first_pending from public.approval_steps s where s.doc_type = cur.doc_type and s.doc_id = cur.doc_id and s.result = 'pending' order by s.seq limit 1;
  if first_pending is distinct from cur.id then raise exception 'REMIND_NOT_PENDING'; end if;
  if not (
    private.step_doc_creator(cur.doc_type, cur.doc_id) = auth.uid()
    or (select private.is_admin()) or (select private.is_director())
    or (cur.project_id is not null and (select private.is_project_insider(cur.project_id)))
  ) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.user_notifications n where n.step_id = cur.id and n.kind = 'approval_reminder' and n.created_at > now() - interval '30 minutes') then
    raise exception 'REMIND_TOO_SOON';
  end if;

  label := case cur.doc_type
    when 'budget' then 'Ngân sách (P-COST-03)' when 'purchase' then 'Đơn đặt hàng (P-CC-07)' when 'payment' then 'Đề nghị thanh toán (P-CF-03)'
    when 'explanatory' then 'Báo cáo giải thích (P-COST-05)' when 'material' then 'Yêu cầu vật tư (P-COST-08)' when 'contract' then 'Xác nhận dự án (P-COST-01)' else cur.doc_type end;
  role_label := case cur.role when 'pic' then 'Phụ trách' when 'technical' then 'P. Kỹ thuật' when 'material' then 'P. Vật tư' when 'warehouse' then 'Kho' when 'accounting' then 'Kế toán'
    when 'leader' then 'Lãnh đạo' when 'admin_office' then 'Hành chánh' else cur.role end;
  pcode := coalesce((select p.code from public.projects p where p.id = cur.project_id), '');
  sender := coalesce((select nullif(pr.full_name, '') from public.profiles pr where pr.id = auth.uid()), '');

  -- Thay lời nhắc cũ (khóa duy nhất user_id + step_id + kind) để chuông hiện lại như mới
  delete from public.user_notifications n where n.step_id = cur.id and n.kind = 'approval_reminder';
  insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
  select u, 'approval_reminder', cur.id, cur.doc_type, cur.doc_id, cur.project_id, 'GẤP: nhắc ký ' || label,
    concat_ws(' · ', nullif(pcode, ''), nullif(private.step_doc_title(cur.doc_type, cur.doc_id), ''), 'ký với vai trò ' || role_label,
      'hạn ' || to_char(cur.target_date, 'DD/MM/YYYY'), nullif('người nhắc: ' || sender, 'người nhắc: '), nullif(left(trim(coalesce(p_note, '')), 300), '')),
    private.step_doc_link(cur.doc_type, cur.doc_id, cur.project_id)
  from private.step_holder_users(cur.role, cur.project_id, cur.assignee_employee_id) u
  where u is distinct from auth.uid()
  on conflict do nothing;
  get diagnostics sent = row_count;
  if sent = 0 then raise exception 'REMIND_NO_SIGNER'; end if;
  return sent;
end;
$$;

revoke all on function public.approval_remind(uuid, text) from public, anon;
grant execute on function public.approval_remind(uuid, text) to authenticated;
