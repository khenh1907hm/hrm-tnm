-- Admin có đủ quyền Giám đốc (tự duyệt vượt cấp, ký mọi bước) để tự test quy trình.
-- Đường dẫn thông báo Báo cáo giải thích (P-COST-05) mở tab Explanatory Report riêng (?muc=bao-cao-giai-thich).

create or replace function private.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_director or role = 'admin' from public.profiles where id = (select auth.uid())), false);
$$;

create or replace function private.step_doc_link(p_type text, p_doc uuid, p_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'purchase' then '/dat-hang/' || p_doc::text
    when 'payment' then '/dat-hang/' || coalesce((select pp.order_id::text from public.purchase_payments pp where pp.id = p_doc), '')
    else case when p_project is null then '' else '/du-an/' || p_project::text || '?muc=' || case p_type
      when 'material' then 'yeu-cau-vat-tu' when 'contract' then 'hop-dong' when 'explanatory' then 'bao-cao-giai-thich' else 'ngan-sach' end end
  end;
$$;

-- Admin gửi ký được đơn nháp của người khác (tự test cả quy trình)
create or replace function public.purchase_submit(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  total bigint;
  chk record;
begin
  if o.requester_id <> auth.uid() and not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('draft', 'rejected') then raise exception 'PO_BAD_STATUS'; end if;
  if not exists (select 1 from public.purchase_items where order_id = p_order) then raise exception 'PO_NO_ITEMS'; end if;
  total := (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = p_order);
  if o.kind = 'project' then
    if o.budget_code is null then raise exception 'PO_BUDGET_CODE_REQUIRED'; end if;
    select * into chk from public.purchase_budget_check(o.project_id, o.budget_code, p_order);
    if chk.sheet_id is null then raise exception 'PO_NO_BUDGET'; end if;
    if chk.budget_a - (chk.ordered_b + total) < 0 then raise exception 'PO_OVER_BUDGET'; end if;
    update public.purchase_orders set status = 'submitted', submitted_at = now(), decision_note = '', total_estimate = total,
      budget_sheet_id = chk.sheet_id, budget_a = chk.budget_a, budget_b = chk.ordered_b, uses_chain = true
      where id = p_order;
    perform private.create_steps('purchase', p_order, o.project_id);
  else
    update public.purchase_orders set status = 'submitted', submitted_at = now(), decision_note = '', total_estimate = total, uses_chain = false where id = p_order;
  end if;
  perform private.purchase_log(p_order, 'submit', '');
end;
$$;

-- Admin duyệt được đơn văn phòng và khoản chi không theo chuỗi ký
create or replace function private.is_purchase_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or coalesce((select private.my_employee_id()) = any (coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')), false)
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('hr', 'engineer', 'employee') and 'purchases.approve' = any (coalesce(p.permissions, '{}')));
$$;
