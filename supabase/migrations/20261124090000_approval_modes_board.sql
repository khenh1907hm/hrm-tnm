-- Kiểu duyệt của từng khối khi có nhiều người, và bảng "Đơn phiếu cần duyệt của tôi".
--  * Kiểu duyệt (mode) theo vai trò ký: 'any' = một người trong khối ký là đủ (mặc định), 'sequence' = lần lượt từng người theo thứ tự (từng cấp).
--    Cấu hình chung: procurement_settings.modes; riêng dự án: projects.approval_modes (áp dụng cho vai trò dự án có đặt người).
--    Thứ tự người: mảng bộ phận chung (departments) và project_approvers.position.
--  * Khối 'sequence' có nhiều người: mỗi người một bước (approval_steps.assignee_employee_id), chỉ người đó (hoặc Admin, Giám đốc) ký.
--    Khối Lãnh đạo lần lượt: người cuối cùng ký mới là phiếu được duyệt.
--  * my_approval_board(): mọi phiếu tôi liên quan, chia cột Chờ tôi duyệt / Đang chờ người khác / Đã duyệt / Bị trả về.

alter table public.procurement_settings add column if not exists modes jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists approval_modes jsonb not null default '{}'::jsonb;
alter table public.project_approvers add column if not exists position smallint not null default 0;
alter table public.approval_steps add column if not exists assignee_employee_id text;
alter table public.approval_steps add column if not exists assignee_name text not null default '';
comment on column public.procurement_settings.modes is 'Kiểu duyệt theo vai trò: {"leader":"sequence"}; thiếu = any (một người là đủ).';
comment on column public.projects.approval_modes is 'Kiểu duyệt riêng của dự án theo vai trò: any | sequence.';
comment on column public.approval_steps.assignee_employee_id is 'Bước dành riêng cho một người (khối duyệt lần lượt); null = ai trong khối cũng ký được.';

-- ───────────────────────── Ai giữ bước ký ─────────────────────────
-- Đúng người của bước (không tính quyền ký thay của Admin, Giám đốc).
create or replace function private.holds_step_strict(p_role text, p_project uuid, p_assignee text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.my_employee_id()) is null then false
    when p_assignee is not null then p_assignee = (select private.my_employee_id())
    when p_role = 'pic' then
      exists (select 1 from public.projects p where p.id = p_project and p.pm_employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.role = 'pm' and m.employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = 'pic' and a.employee_id = (select private.my_employee_id()))
    when (select private.project_role_assigned(p_role, p_project)) then
      exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = p_role and a.employee_id = (select private.my_employee_id()))
    else (select private.in_department(p_role))
  end;
$$;

create or replace function private.can_sign_step(p_role text, p_project uuid, p_assignee text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.is_director()) or (select private.holds_step_strict(p_role, p_project, p_assignee));
$$;

create or replace function private.holds_step_role(p_role text, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_sign_step(p_role, p_project, null));
$$;

-- ───────────────────────── Dựng chuỗi ký ─────────────────────────
create or replace function private.create_steps(p_type text, p_doc uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  roles text[] := case p_type
    when 'budget' then array['pic', 'technical', 'leader']
    when 'payment' then array['pic', 'technical', 'material', 'leader']
    when 'explanatory' then array['pic', 'technical', 'material', 'accounting', 'leader']
    when 'material' then array['material', 'technical', 'leader']
    when 'contract' then array['pic', 'technical', 'material', 'leader', 'accounting', 'admin_office']
    else array['pic', 'technical', 'material', 'accounting', 'leader', 'admin_office'] end;
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    when 'explanatory' then array[1, 1, 1, 2, 2]
    when 'material' then array[1, 1, 1]
    when 'contract' then array[1, 1, 1, 1, 1, 1]
    else array[1, 1, 2, 3, 3, 3] end;
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  modes jsonb := coalesce((select s.modes from public.procurement_settings s where id = 1), '{}'::jsonb);
  pmodes jsonb := coalesce((select p.approval_modes from public.projects p where p.id = p_project), '{}'::jsonb);
  start date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  target date;
  people text[];
  mode text;
  emp text;
  i int;
  k int;
  n int := 0;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;
  for i in 1 .. array_length(roles, 1) loop
    target := start;
    for k in 1 .. days[i] loop target := private.next_workday(target); end loop;
    if roles[i] = 'pic' then
      people := '{}'; mode := 'any';
    elsif (select private.project_role_assigned(roles[i], p_project)) then
      people := array(select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = roles[i] order by a.position, a.created_at);
      mode := coalesce(pmodes ->> roles[i], 'any');
    else
      people := array(select x from jsonb_array_elements_text(coalesce(deps -> roles[i], '[]'::jsonb)) with ordinality t(x, o) order by o);
      mode := coalesce(modes ->> roles[i], 'any');
    end if;
    skipped := roles[i] <> 'pic' and cardinality(people) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    if mode = 'sequence' and cardinality(people) > 1 then
      foreach emp in array people loop
        n := n + 1;
        insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result, assignee_employee_id, assignee_name)
        values (p_type, p_doc, p_project, n, roles[i], target, 'pending', emp,
          coalesce((select coalesce(e.doc ->> 'name', e.code) from public.employees e where e.id = emp), ''));
      end loop;
    else
      n := n + 1;
      insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
      values (p_type, p_doc, p_project, n, roles[i], target, case when skipped then 'skipped' else 'pending' end);
    end if;
  end loop;
end;
$$;

-- ───────────────────────── Ký ─────────────────────────
-- Như bản trước, thêm: kiểm tra người của bước (assignee), và khối Lãnh đạo lần lượt thì người cuối ký mới là duyệt.
create or replace function public.approval_sign(p_step uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.approval_steps;
  cur uuid;
  o public.purchase_orders;
  pay public.purchase_payments;
  chk record;
  decides boolean;
  who text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
begin
  select * into st from public.approval_steps where id = p_step for update;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  if exists (select 1 from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'returned') then raise exception 'STEP_NOT_CURRENT'; end if;
  select id into cur from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'pending' order by seq limit 1;
  if cur is distinct from st.id then raise exception 'STEP_NOT_CURRENT'; end if;
  if not (select private.can_sign_step(st.role, st.project_id, st.assignee_employee_id)) then raise exception 'STEP_NOT_YOURS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  decides := st.role = 'leader' and not exists (select 1 from public.approval_steps x where x.doc_type = st.doc_type and x.doc_id = st.doc_id
    and x.role = 'leader' and x.result = 'pending' and x.id <> st.id);

  if st.doc_type = 'purchase' then
    o := private.purchase_lock(st.doc_id);
    if o.status <> 'submitted' then raise exception 'PO_BAD_STATUS'; end if;
  elsif st.doc_type = 'payment' then
    select * into pay from public.purchase_payments where id = st.doc_id for update;
    if not found or pay.status <> 'requested' then raise exception 'PO_BAD_STATUS'; end if;
    perform private.purchase_lock(pay.order_id);
  elsif st.doc_type = 'explanatory' then
    if not exists (select 1 from public.explanatory_reports where id = st.doc_id and status = 'submitted') then raise exception 'EXP_BAD_STATUS'; end if;
  elsif st.doc_type = 'material' then
    if not exists (select 1 from public.material_requests where id = st.doc_id and status = 'submitted') then raise exception 'MR_BAD_STATUS'; end if;
  elsif st.doc_type = 'contract' then
    if not exists (select 1 from public.project_contracts where id = st.doc_id and status in ('submitted', 'approved')) then raise exception 'CONTRACT_BAD_STATUS'; end if;
  elsif not exists (select 1 from public.project_budget_sheets where id = st.doc_id and status = 'submitted') then
    raise exception 'BUDGET_BAD_STATUS';
  end if;

  update public.approval_steps set result = case when p_approve then 'signed' else 'returned' end, signer_id = auth.uid(), signer_name = who,
    note = btrim(coalesce(p_note, '')), acted_at = now() where id = p_step;

  if not p_approve then
    if st.doc_type = 'purchase' then
      update public.purchase_orders set status = 'rejected', decision_note = btrim(p_note) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'reject', btrim(p_note));
    elsif st.doc_type = 'payment' then
      update public.purchase_payments set status = 'rejected', decision_note = btrim(p_note) where id = st.doc_id;
      perform private.purchase_log(pay.order_id, 'payment_reject:' || pay.kind, pay.rfp_no || ' · ' || btrim(p_note));
    elsif st.doc_type = 'explanatory' then
      update public.explanatory_reports set status = 'rejected' where id = st.doc_id;
    elsif st.doc_type = 'material' then
      update public.material_requests set status = 'rejected' where id = st.doc_id;
    elsif st.doc_type = 'contract' then
      update public.project_contracts set status = 'rejected' where id = st.doc_id;
    else
      update public.project_budget_sheets set status = 'rejected' where id = st.doc_id;
    end if;
    return;
  end if;

  if st.doc_type = 'purchase' then
    perform private.purchase_log(st.doc_id, 'sign:' || st.role, btrim(coalesce(p_note, '')));
    if decides then
      select * into chk from public.purchase_budget_check(o.project_id, o.budget_code, o.id);
      if chk.sheet_id is null or chk.budget_a - (chk.ordered_b + o.total_estimate) < 0 then raise exception 'PO_OVER_BUDGET'; end if;
      update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now(), budget_a = chk.budget_a, budget_b = chk.ordered_b,
        budget_sheet_id = chk.sheet_id, decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'approve', btrim(coalesce(p_note, '')));
    end if;
  elsif st.doc_type = 'payment' then
    if decides then
      update public.purchase_payments set status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(pay.order_id, 'payment_approve:' || pay.kind, pay.rfp_no || ' · ' || pay.amount::text || ' đ');
    else
      perform private.purchase_log(pay.order_id, 'payment_sign:' || st.role, pay.rfp_no);
    end if;
  elsif st.doc_type = 'explanatory' then
    if decides then
      perform private.explanatory_approve(st.doc_id);
      perform private.log_event('explanatory.approve', 'explanatory_report', st.doc_id::text, '{}'::jsonb);
    end if;
  elsif st.doc_type = 'material' then
    if decides then update public.material_requests set status = 'approved', approved_at = now() where id = st.doc_id; end if;
  elsif st.doc_type = 'contract' then
    if decides then
      update public.project_contracts set status = 'superseded' where project_id = st.project_id and status = 'approved' and id <> st.doc_id;
      update public.project_contracts set status = 'approved', approved_at = now() where id = st.doc_id;
      perform private.log_event('contract.approve', 'project_contract', st.doc_id::text, '{}'::jsonb);
    end if;
  elsif decides then
    perform private.budget_sheet_approve(st.doc_id);
    perform private.log_event('budget.approve', 'project_budget_sheet', st.doc_id::text, '{}'::jsonb);
  end if;
end;
$$;

-- Giám đốc duyệt ngay: bỏ qua mọi bước chờ trước bước Lãnh đạo cuối cùng, rồi ký bước đó.
create or replace function public.approval_director_approve(p_type text, p_doc uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  leader_step public.approval_steps;
begin
  if not (select private.is_director()) then raise exception 'NOT_DIRECTOR'; end if;
  if exists (select 1 from public.approval_steps where doc_type = p_type and doc_id = p_doc and result = 'returned') then raise exception 'STEP_NOT_CURRENT'; end if;
  select * into leader_step from public.approval_steps where doc_type = p_type and doc_id = p_doc and role = 'leader' and result = 'pending' order by seq desc limit 1 for update;
  if not found then raise exception 'STEP_NOT_CURRENT'; end if;
  perform set_config('app.skip_notify', '1', true);
  update public.approval_steps set result = 'skipped', note = 'Giám đốc duyệt vượt cấp', acted_at = now()
  where doc_type = p_type and doc_id = p_doc and result = 'pending' and seq < leader_step.seq;
  perform set_config('app.skip_notify', '', true);
  perform public.approval_sign(leader_step.id, true, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Giám đốc duyệt'));
end;
$$;

drop function if exists public.approval_steps_of(text, uuid);
create function public.approval_steps_of(p_type text, p_doc uuid)
returns table (id uuid, seq smallint, role text, target_date date, result text, signer_name text, note text, acted_at timestamptz, can_sign boolean, assignee_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with steps as (
    select s.* from public.approval_steps s
    where s.doc_type = p_type and s.doc_id = p_doc and (select private.can_view_step_doc(s.doc_type, s.doc_id, s.project_id))
  ),
  cur as (select st.id from steps st where st.result = 'pending' and not exists (select 1 from steps r where r.result = 'returned') order by st.seq limit 1)
  select s.id, s.seq, s.role, s.target_date, s.result, s.signer_name, s.note, s.acted_at,
    s.id = (select cur.id from cur) and (select private.can_sign_step(s.role, s.project_id, s.assignee_employee_id)),
    s.assignee_name
  from steps s order by s.seq;
$$;

create or replace function public.my_approvals()
returns table (step_id uuid, doc_type text, doc_id uuid, project_id uuid, project_code text, title text, amount bigint, role text, target_date date, order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (
    select distinct on (s.doc_type, s.doc_id) s.*
    from public.approval_steps s
    where s.result = 'pending'
      and not exists (select 1 from public.approval_steps r where r.doc_type = s.doc_type and r.doc_id = s.doc_id and r.result = 'returned')
    order by s.doc_type, s.doc_id, s.seq
  )
  select c.id, c.doc_type, c.doc_id, c.project_id, p.code,
    case c.doc_type
      when 'purchase' then (select o.code || ' · ' || o.title from public.purchase_orders o where o.id = c.doc_id)
      when 'payment' then (select pp.rfp_no || ' · ' || o.code || ' · ' || o.title from public.purchase_payments pp join public.purchase_orders o on o.id = pp.order_id where pp.id = c.doc_id)
      when 'explanatory' then (select r.number || ' · ' || left(r.explanation, 60) from public.explanatory_reports r where r.id = c.doc_id)
      when 'material' then (select m.number || ' · ' || (select count(*) from public.material_request_items i where i.request_id = m.id) || ' dòng vật tư' from public.material_requests m where m.id = c.doc_id)
      when 'contract' then (select 'Xác nhận dự án lần ' || k.revision from public.project_contracts k where k.id = c.doc_id)
      else 'Ngân sách ' || (select b.number from public.project_budget_sheets b where b.id = c.doc_id) end,
    case c.doc_type
      when 'purchase' then (select o.total_estimate from public.purchase_orders o where o.id = c.doc_id)
      when 'payment' then (select pp.amount + pp.vat_amount from public.purchase_payments pp where pp.id = c.doc_id)
      when 'explanatory' then (select greatest(coalesce(sum(l.ordered_b + l.needed_c - l.budget_a), 0), 0)::bigint from public.explanatory_report_lines l where l.report_id = c.doc_id)
      when 'material' then 0::bigint
      when 'contract' then (select k.confirmed_value from public.project_contracts k where k.id = c.doc_id)
      else (select coalesce(sum(l.budget), 0)::bigint from public.project_budget_lines l where l.sheet_id = c.doc_id) end,
    c.role, c.target_date,
    case c.doc_type when 'payment' then (select pp.order_id from public.purchase_payments pp where pp.id = c.doc_id) end
  from cur c left join public.projects p on p.id = c.project_id
  where (select private.can_sign_step(c.role, c.project_id, c.assignee_employee_id))
  order by c.target_date, c.doc_type;
$$;

-- ───────────────────────── Thông báo theo người của bước ─────────────────────────
drop function if exists private.step_holder_users(text, uuid);
create or replace function private.step_holder_users(p_role text, p_project uuid, p_assignee text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emps text[];
begin
  if p_assignee is not null then
    emps := array[p_assignee];
  elsif p_role = 'pic' then
    emps := array(select p.pm_employee_id from public.projects p where p.id = p_project and p.pm_employee_id is not null
      union select m.employee_id from public.project_members m where m.project_id = p_project and m.role = 'pm' and (m.left_on is null or m.left_on >= current_date)
      union select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = 'pic');
  elsif (select private.project_role_assigned(p_role, p_project)) then
    emps := array(select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = p_role);
  else
    emps := array(select jsonb_array_elements_text(coalesce((select departments -> p_role from public.procurement_settings where id = 1), '[]'::jsonb)));
    if p_role = 'leader' then
      emps := emps || coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}');
    end if;
  end if;
  return query
    select distinct pr.id from public.profiles pr
    where (pr.employee_id = any (emps) and pr.role <> 'pending')
       or (p_role = 'leader' and pr.is_director)
       or (p_assignee is null and p_role = 'leader' and not (select private.project_role_assigned('leader', p_project)) and pr.role in ('hr', 'engineer', 'employee') and 'purchases.approve' = any (coalesce(pr.permissions, '{}')));
  if not found then
    return query select pr.id from public.profiles pr where pr.role = 'admin';
  end if;
end;
$$;
revoke all on function private.step_holder_users(text, uuid, text) from public, anon, authenticated;

create or replace function private.approval_steps_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.approval_steps;
  label text := case new.doc_type
    when 'budget' then 'Ngân sách (P-COST-03)' when 'purchase' then 'Đơn đặt hàng (P-CC-07)' when 'payment' then 'Đề nghị thanh toán (P-CF-03)'
    when 'explanatory' then 'Báo cáo giải thích (P-COST-05)' when 'material' then 'Yêu cầu vật tư (P-COST-08)' when 'contract' then 'Xác nhận dự án (P-COST-01)' else new.doc_type end;
  role_label text;
  doc_title text;
  pcode text;
  link text;
  creator uuid;
begin
  if coalesce(current_setting('app.skip_notify', true), '') = '1' then return null; end if;
  doc_title := private.step_doc_title(new.doc_type, new.doc_id);
  pcode := coalesce((select p.code from public.projects p where p.id = new.project_id), '');
  link := private.step_doc_link(new.doc_type, new.doc_id, new.project_id);
  if tg_op = 'UPDATE' and new.result = 'returned' and old.result <> 'returned' then
    creator := private.step_doc_creator(new.doc_type, new.doc_id);
    if creator is not null then
      insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
      values (creator, 'approval_returned', new.id, new.doc_type, new.doc_id, new.project_id, 'Phiếu bị trả về: ' || label,
        concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), nullif(new.signer_name, ''), nullif(new.note, '')), link)
      on conflict do nothing;
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.result = 'signed' and old.result <> 'signed' and new.role = 'leader'
     and not exists (select 1 from public.approval_steps x where x.doc_type = new.doc_type and x.doc_id = new.doc_id and x.role = 'leader' and x.result = 'pending') then
    creator := private.step_doc_creator(new.doc_type, new.doc_id);
    if creator is not null and creator is distinct from new.signer_id then
      insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
      values (creator, 'approval_approved', new.id, new.doc_type, new.doc_id, new.project_id, 'Đã duyệt: ' || label,
        concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), nullif(new.signer_name, '')), link)
      on conflict do nothing;
    end if;
  end if;

  if exists (select 1 from public.approval_steps r where r.doc_type = new.doc_type and r.doc_id = new.doc_id and r.result = 'returned') then return null; end if;
  select * into cur from public.approval_steps s where s.doc_type = new.doc_type and s.doc_id = new.doc_id and s.result = 'pending' order by s.seq limit 1;
  if not found then return null; end if;
  role_label := case cur.role when 'pic' then 'Phụ trách' when 'technical' then 'P. Kỹ thuật' when 'material' then 'P. Vật tư' when 'accounting' then 'Kế toán'
    when 'leader' then 'Lãnh đạo' when 'admin_office' then 'Hành chánh' else cur.role end;
  insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
  select u, 'approval_pending', cur.id, cur.doc_type, cur.doc_id, cur.project_id, 'Cần bạn duyệt: ' || label,
    concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), 'ký với vai trò ' || role_label, 'hạn ' || to_char(cur.target_date, 'DD/MM/YYYY')), link
  from private.step_holder_users(cur.role, cur.project_id, cur.assignee_employee_id) u
  where u is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;

-- ───────────────────────── Cấu hình (Admin) ─────────────────────────
-- Người trong từng bộ phận theo thứ tự (cấp 1, 2…).
create or replace function public.procurement_departments()
returns table (department text, employee_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.key, e.id, coalesce(e.doc ->> 'name', e.code)
  from public.procurement_settings s, jsonb_each(s.departments) d, jsonb_array_elements_text(d.value) with ordinality m(id, ord)
  join public.employees e on e.id = m.id
  where s.id = 1
  order by d.key, m.ord;
$$;

create or replace function public.approval_settings_save(p_departments jsonb, p_modes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_departments, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_modes, '{}'::jsonb)) <> 'object' then raise exception 'BAD_INPUT'; end if;
  update public.procurement_settings set departments = coalesce(p_departments, departments),
    modes = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(coalesce(p_modes, '{}'::jsonb)) x(k, v) where v in ('any', 'sequence')),
    updated_at = now()
  where id = 1;
  perform private.log_event('approval.settings', 'procurement_settings', '1', jsonb_build_object('departments', p_departments, 'modes', p_modes));
end;
$$;

-- Người duyệt dự án theo thứ tự + kiểu duyệt từng vai trò.
drop function if exists public.project_approvers_set(uuid, jsonb);
create or replace function public.project_approvers_set(p_project uuid, p_items jsonb, p_modes jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.can_edit_approvers(p_project)) then raise exception 'FORBIDDEN'; end if;
  delete from public.project_approvers where project_id = p_project;
  insert into public.project_approvers (project_id, role, employee_id, position)
  select p_project, x ->> 'role', x ->> 'employeeId', min(o)::smallint
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality t(x, o)
  where x ->> 'role' in ('pic', 'technical', 'material', 'accounting', 'leader', 'admin_office') and coalesce(x ->> 'employeeId', '') <> ''
  group by x ->> 'role', x ->> 'employeeId';
  if p_modes is not null then
    update public.projects set approval_modes = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_modes) m(k, v) where v in ('any', 'sequence'))
    where id = p_project;
  end if;
  perform private.log_event('project.approvers', 'project', p_project::text, jsonb_build_object('items', coalesce(p_items, '[]'::jsonb), 'modes', p_modes));
end;
$$;

create or replace function public.project_approvers_of(p_project uuid)
returns table (role text, employee_id text, code text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.role, a.employee_id, coalesce(e.code, ''), coalesce(e.doc ->> 'name', e.code, a.employee_id)
  from public.project_approvers a left join public.employees e on e.id = a.employee_id
  where a.project_id = p_project and (select private.can_view_project(p_project))
  order by a.role, a.position, a.created_at;
$$;

-- ───────────────────────── Bảng Đơn phiếu cần duyệt của tôi ─────────────────────────
create or replace function public.my_approval_board()
returns table (doc_type text, doc_id uuid, project_id uuid, project_code text, title text, amount bigint, creator_name text, column_key text,
  current_step_id uuid, step_role text, current_assignee text, current_target date, can_sign boolean, signed_count int, total_count int, updated_at timestamptz, link text)
language sql
stable
security definer
set search_path = ''
as $$
  with docs as (
    select s.doc_type, s.doc_id, (array_agg(s.project_id))[1] as project_id,
      bool_or(s.result = 'returned') as returned,
      count(*) filter (where s.result <> 'skipped')::int as total,
      count(*) filter (where s.result = 'signed')::int as signed,
      coalesce(bool_and(s.result <> 'pending') filter (where s.role = 'leader'), false) as leader_done,
      max(coalesce(s.acted_at, s.created_at)) as updated_at,
      bool_or(s.signer_id = (select auth.uid())) as i_signed,
      bool_or((select private.holds_step_strict(s.role, s.project_id, s.assignee_employee_id))) as i_hold
    from public.approval_steps s
    group by s.doc_type, s.doc_id
  ),
  cur as (
    select distinct on (s.doc_type, s.doc_id) s.* from public.approval_steps s where s.result = 'pending' order by s.doc_type, s.doc_id, s.seq
  ),
  board as (
    select d.*, c.id as cur_id, c.role as cur_role, c.assignee_name as cur_assignee, c.target_date as cur_target,
      c.id is not null and not d.returned and (select private.can_sign_step(c.role, c.project_id, c.assignee_employee_id)) as can_sign,
      c.id is not null and not d.returned and (select private.holds_step_strict(c.role, c.project_id, c.assignee_employee_id)) as mine,
      private.step_doc_creator(d.doc_type, d.doc_id) as creator
    from docs d left join cur c on c.doc_type = d.doc_type and c.doc_id = d.doc_id
  )
  select b.doc_type, b.doc_id, b.project_id, coalesce(p.code, ''), private.step_doc_title(b.doc_type, b.doc_id),
    case b.doc_type
      when 'purchase' then (select o.total_estimate from public.purchase_orders o where o.id = b.doc_id)
      when 'payment' then (select pp.amount + pp.vat_amount from public.purchase_payments pp where pp.id = b.doc_id)
      when 'contract' then (select k.confirmed_value from public.project_contracts k where k.id = b.doc_id)
      when 'budget' then (select coalesce(sum(l.budget), 0)::bigint from public.project_budget_lines l where l.sheet_id = b.doc_id)
      else 0::bigint end,
    coalesce((select pr.full_name from public.profiles pr where pr.id = b.creator), ''),
    case when b.mine then 'todo' when b.returned then 'returned' when b.cur_id is null or b.leader_done then 'approved' else 'waiting' end,
    case when b.returned then null else b.cur_id end, b.cur_role, b.cur_assignee, b.cur_target, b.can_sign, b.signed, b.total, b.updated_at,
    private.step_doc_link(b.doc_type, b.doc_id, b.project_id)
  from board b left join public.projects p on p.id = b.project_id
  where (b.mine or b.i_signed or b.i_hold or b.creator = (select auth.uid()) or (select private.is_admin()) or (select private.is_director()))
    and (b.updated_at > now() - interval '120 days' or (b.cur_id is not null and not b.returned))
    and (select private.can_view_step_doc(b.doc_type, b.doc_id, b.project_id))
  order by b.updated_at desc
  limit 300;
$$;

revoke all on function private.holds_step_strict(text, uuid, text), private.can_sign_step(text, uuid, text) from public, anon;
grant execute on function private.holds_step_strict(text, uuid, text), private.can_sign_step(text, uuid, text) to authenticated;
revoke all on function public.approval_steps_of(text, uuid), public.approval_settings_save(jsonb, jsonb), public.project_approvers_set(uuid, jsonb, jsonb), public.my_approval_board() from public, anon;
grant execute on function public.approval_steps_of(text, uuid), public.approval_settings_save(jsonb, jsonb), public.project_approvers_set(uuid, jsonb, jsonb), public.my_approval_board() to authenticated;
