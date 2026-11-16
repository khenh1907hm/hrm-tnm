-- PO do người lập / phụ trách nắm: Đơn hàng nháp → Lập đơn → PO, NCC ký nhận → tạm ứng, theo dõi, chứng từ đều là người lập (phụ trách dự án).
-- Chỉ khâu Nhận hàng, kiểm đếm và Nhập kho giao cho Kho. Kho / Vật tư và Admin vẫn làm thay được.

create or replace function private.stage_department(p_stage text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.stage_departments ->> p_stage from public.procurement_settings s where s.id = 1),
    case p_stage
      when 'draft' then 'pic' when 'submitted' then 'pic' when 'approved' then 'leader' when 'po' then 'pic'
      when 'advance' then 'pic' when 'advance_pay' then 'accounting' when 'ordered' then 'pic'
      when 'prepayment' then 'pic' when 'prepayment_pay' then 'accounting' when 'received' then 'warehouse'
      when 'stocked' then 'warehouse' when 'final' then 'pic' when 'final_pay' then 'accounting' else '' end);
$$;

-- Phát hành PO chính thức: người lập, phụ trách dự án (PM / trưởng), Kho / Vật tư, Admin, Giám đốc
create or replace function public.purchase_issue_po(p_order uuid, p_supplier text, p_contact text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  po text;
begin
  if not (select private.is_admin()) and not (select private.is_director()) and o.requester_id <> auth.uid()
    and not (o.project_id is not null and ((select private.is_project_lead(o.project_id)) or (select private.holds_step_strict('pic', o.project_id, null))))
    and not (select private.holds_step_role('material', o.project_id)) then raise exception 'FORBIDDEN'; end if;
  if not o.uses_chain or o.status <> 'approved' or o.po_issued_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  if char_length(btrim(coalesce(p_supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  po := 'PO-' || (select code from public.projects where id = o.project_id) || '-'
    || lpad(((select count(*) from public.purchase_orders where project_id = o.project_id and po_no <> '') + 1)::text, 3, '0');
  update public.purchase_orders set po_no = po, po_issued_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')) where id = p_order;
  perform private.purchase_log(p_order, 'issue_po', po || ' · ' || btrim(p_supplier));
  return po;
end;
$$;
