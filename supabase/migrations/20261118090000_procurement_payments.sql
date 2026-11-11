-- Mua hàng dự án: tạm ứng / thanh toán theo điều kiện của NCC (docs/dac-ta-mua-hang-du-an.md, PRC-30..33). Chạy sau 20261117090000.
--  * Đơn ghi điều kiện thanh toán NCC: có cần tạm ứng (bao nhiêu %), có cần thanh toán trước.
--  * NCC cần tạm ứng: phải chi xong tạm ứng mới được Đặt hàng / theo dõi. Không cần thì đi thẳng sang theo dõi.
--  * Đề nghị tạm ứng / thanh toán (P-CF-03): số RFP, số + ngày hóa đơn ("tạm ứng" khi tạm ứng), tiền trước thuế, thuế GTGT.
--    Đơn dự án: ký Phụ trách → P. Kỹ thuật → P. Vật tư → Lãnh đạo, rồi Kế toán chi. Tổng trước thuế không vượt giá trị đơn.

alter table public.purchase_orders
  add column advance_required boolean not null default false,
  add column advance_pct numeric(5, 2) check (advance_pct is null or (advance_pct > 0 and advance_pct <= 100)),
  add column prepay_required boolean not null default false;

alter table public.purchase_payments
  add column rfp_no text not null default '',
  add column invoice_no text not null default '',
  add column invoice_date date,
  add column vat_amount bigint not null default 0 check (vat_amount >= 0),
  add column uses_chain boolean not null default false;

create sequence public.purchase_rfp_seq;

alter table public.approval_steps drop constraint approval_steps_doc_type_check;
alter table public.approval_steps add constraint approval_steps_doc_type_check check (doc_type in ('budget', 'purchase', 'payment'));

drop policy "approval_steps: đọc" on public.approval_steps;
create policy "approval_steps: đọc" on public.approval_steps for select to authenticated using (
  (doc_type = 'budget' and project_id is not null and (select private.can_see_budget(project_id)))
  or (doc_type = 'purchase' and (select private.can_view_purchase(doc_id)))
  or (doc_type = 'payment' and exists (select 1 from public.purchase_payments p where p.id = doc_id and (select private.can_view_purchase(p.order_id))))
);

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
    else array['pic', 'technical', 'material', 'accounting', 'leader', 'admin_office'] end;
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  target date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  i int;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;
  for i in 1 .. array_length(roles, 1) loop
    skipped := roles[i] <> 'pic' and jsonb_array_length(coalesce(deps -> roles[i], '[]'::jsonb)) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    if not skipped then target := private.next_workday(target); end if;
    insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
    values (p_type, p_doc, p_project, i, roles[i], target, case when skipped then 'skipped' else 'pending' end);
  end loop;
end;
$$;

-- NCC cần tạm ứng: phải có khoản tạm ứng đã chi mới được đặt hàng.
create or replace function public.purchase_mark_ordered(p_order uuid, p_supplier text, p_contact text, p_expected date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'approved' then raise exception 'PO_BAD_STATUS'; end if;
  if char_length(btrim(coalesce(p_supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  if o.advance_required and not exists (select 1 from public.purchase_payments where order_id = p_order and kind = 'advance' and status = 'paid') then raise exception 'PO_ADVANCE_NOT_PAID'; end if;
  update public.purchase_orders set status = 'ordered', ordered_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')), expected_delivery = p_expected
    where id = p_order;
  perform private.purchase_log(p_order, 'order', concat_ws(' · ', btrim(p_supplier), case when p_expected is not null then 'giao dự kiến ' || to_char(p_expected, 'DD/MM/YYYY') end, nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

-- Đề nghị tạm ứng / thanh toán (P-CF-03). Thay hàm purchase_request_payment cũ.
drop function public.purchase_request_payment(uuid, text, bigint, text, text);
create or replace function public.purchase_request_rfp(p_order uuid, p_kind text, p_amount bigint, p_vat bigint, p_invoice_no text, p_invoice_date date, p_payee text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  pid uuid;
  rfp text;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_purchase_payer()) and not (select private.is_admin())
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id))) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('advance', 'prepayment', 'final') then raise exception 'PO_BAD_PAYMENT'; end if;
  if o.status not in ('approved', 'ordered', 'received') or (p_kind = 'final' and o.status = 'approved') then raise exception 'PO_BAD_STATUS'; end if;
  if o.uses_chain and ((p_kind = 'advance' and not o.advance_required) or (p_kind = 'prepayment' and not o.prepay_required)) then raise exception 'PO_PAYMENT_NOT_NEEDED'; end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(p_vat, 0) < 0 then raise exception 'PO_BAD_AMOUNT'; end if;
  if p_kind <> 'advance' and char_length(btrim(coalesce(p_invoice_no, ''))) < 1 then raise exception 'PO_INVOICE_REQUIRED'; end if;
  if (select coalesce(sum(amount), 0) from public.purchase_payments where order_id = p_order and status <> 'rejected') + p_amount > coalesce(o.total_actual, o.total_estimate) then
    raise exception 'PO_PAY_OVER';
  end if;
  rfp := 'RFP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.purchase_rfp_seq')::text, 4, '0');
  insert into public.purchase_payments (order_id, kind, amount, payee, note, rfp_no, invoice_no, invoice_date, vat_amount, uses_chain)
  values (p_order, p_kind, p_amount, btrim(coalesce(p_payee, '')), btrim(coalesce(p_note, '')), rfp,
    case when p_kind = 'advance' then 'tạm ứng' else btrim(p_invoice_no) end, p_invoice_date, coalesce(p_vat, 0), o.uses_chain)
  returning id into pid;
  if o.uses_chain then perform private.create_steps('payment', pid, o.project_id); end if;
  perform private.purchase_log(p_order, 'payment_request:' || p_kind, rfp || ' · ' || p_amount::text || ' đ' || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
  return pid;
end;
$$;

-- Khoản của đơn dự án đi chuỗi ký, không duyệt một bước.
create or replace function public.purchase_decide_payment(p_payment uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pay public.purchase_payments;
begin
  select * into pay from public.purchase_payments where id = p_payment for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  perform private.purchase_lock(pay.order_id);
  if pay.uses_chain then raise exception 'PO_USE_CHAIN'; end if;
  if not (select private.is_purchase_approver()) then raise exception 'PO_NOT_APPROVER'; end if;
  if pay.status <> 'requested' then raise exception 'PO_BAD_STATUS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  update public.purchase_payments set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(), decision_note = btrim(coalesce(p_note, '')) where id = p_payment;
  perform private.purchase_log(pay.order_id, case when p_approve then 'payment_approve:' else 'payment_reject:' end || pay.kind, pay.amount::text || ' đ' || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
end;
$$;

-- Ký / trả về: thêm đề nghị thanh toán (Lãnh đạo ký là khoản chờ Kế toán chi).
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
  who text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
begin
  select * into st from public.approval_steps where id = p_step for update;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  if exists (select 1 from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'returned') then raise exception 'STEP_NOT_CURRENT'; end if;
  select id into cur from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'pending' order by seq limit 1;
  if cur is distinct from st.id then raise exception 'STEP_NOT_CURRENT'; end if;
  if not (select private.holds_step_role(st.role, st.project_id)) then raise exception 'STEP_NOT_YOURS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;

  if st.doc_type = 'purchase' then
    o := private.purchase_lock(st.doc_id);
    if o.status <> 'submitted' then raise exception 'PO_BAD_STATUS'; end if;
  elsif st.doc_type = 'payment' then
    select * into pay from public.purchase_payments where id = st.doc_id for update;
    if not found or pay.status <> 'requested' then raise exception 'PO_BAD_STATUS'; end if;
    perform private.purchase_lock(pay.order_id);
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
    else
      update public.project_budget_sheets set status = 'rejected' where id = st.doc_id;
    end if;
    return;
  end if;

  if st.doc_type = 'purchase' then
    perform private.purchase_log(st.doc_id, 'sign:' || st.role, btrim(coalesce(p_note, '')));
    if st.role = 'leader' then
      select * into chk from public.purchase_budget_check(o.project_id, o.budget_code, o.id);
      if chk.sheet_id is null or chk.budget_a - (chk.ordered_b + o.total_estimate) < 0 then raise exception 'PO_OVER_BUDGET'; end if;
      update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now(), budget_a = chk.budget_a, budget_b = chk.ordered_b,
        budget_sheet_id = chk.sheet_id, decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'approve', btrim(coalesce(p_note, '')));
    end if;
  elsif st.doc_type = 'payment' then
    if st.role = 'leader' then
      update public.purchase_payments set status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(pay.order_id, 'payment_approve:' || pay.kind, pay.rfp_no || ' · ' || pay.amount::text || ' đ');
    else
      perform private.purchase_log(pay.order_id, 'payment_sign:' || st.role, pay.rfp_no);
    end if;
  elsif st.role = 'leader' then
    perform private.budget_sheet_approve(st.doc_id);
    perform private.log_event('budget.approve', 'project_budget_sheet', st.doc_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.approval_steps_of(p_type text, p_doc uuid)
returns table (id uuid, seq smallint, role text, target_date date, result text, signer_name text, note text, acted_at timestamptz, can_sign boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with steps as (
    select s.* from public.approval_steps s
    where s.doc_type = p_type and s.doc_id = p_doc
      and ((p_type = 'budget' and (select private.can_see_budget(s.project_id)))
        or (p_type = 'purchase' and (select private.can_view_purchase(p_doc)))
        or (p_type = 'payment' and exists (select 1 from public.purchase_payments p where p.id = p_doc and (select private.can_view_purchase(p.order_id)))))
  ),
  cur as (select st.id from steps st where st.result = 'pending' and not exists (select 1 from steps r where r.result = 'returned') order by st.seq limit 1)
  select s.id, s.seq, s.role, s.target_date, s.result, s.signer_name, s.note, s.acted_at,
    s.id = (select cur.id from cur) and (select private.holds_step_role(s.role, s.project_id))
  from steps s order by s.seq;
$$;

drop function public.my_approvals();
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
      else 'Ngân sách ' || (select b.number from public.project_budget_sheets b where b.id = c.doc_id) end,
    case c.doc_type
      when 'purchase' then (select o.total_estimate from public.purchase_orders o where o.id = c.doc_id)
      when 'payment' then (select pp.amount + pp.vat_amount from public.purchase_payments pp where pp.id = c.doc_id)
      else (select coalesce(sum(l.budget), 0)::bigint from public.project_budget_lines l where l.sheet_id = c.doc_id) end,
    c.role, c.target_date,
    case c.doc_type when 'payment' then (select pp.order_id from public.purchase_payments pp where pp.id = c.doc_id) end
  from cur c left join public.projects p on p.id = c.project_id
  where (select private.holds_step_role(c.role, c.project_id))
  order by c.target_date, c.doc_type;
$$;

revoke all on function public.purchase_request_rfp(uuid, text, bigint, bigint, text, date, text, text), public.my_approvals() from public, anon;
grant execute on function public.purchase_request_rfp(uuid, text, bigint, bigint, text, date, text, text), public.my_approvals() to authenticated;
