-- Sửa cho khớp biểu mẫu công ty (chạy sau 20261118090000):
--  1. Ngày mục tiêu theo mẫu, không cộng dồn từng bước: P-CC-07 Phụ trách, Kỹ thuật ngày 1; Vật tư ngày 2; Kế toán, Lãnh đạo, Hành chánh ngày 3.
--     P-COST-03: ngày 1 (Phụ trách, Kỹ thuật), ngày 2 (Lãnh đạo). P-CF-03: ngày 1 (Phụ trách, Kỹ thuật, Vật tư), ngày 2 (Lãnh đạo).
--  2. Điều khoản PO: PO chỉ hiệu lực khi NCC ký bản sao gửi lại. Đơn dự án: Hành chánh phát hành PO (số PO), ghi nhận NCC ký nhận,
--     rồi mới tạm ứng / đặt hàng (PRC-34).
--  3. Rủi ro chuyển sang bên mua khi giao hàng có xác nhận bằng văn bản của cả hai bên: nhận hàng đơn dự án cần số biên bản
--     giao nhận đã có chữ ký hai bên (PRC-35).

alter table public.purchase_orders
  add column po_no text not null default '',
  add column po_issued_at timestamptz,
  add column supplier_accepted_at timestamptz,
  add column supplier_accept_note text not null default '',
  add column receipt_record_no text not null default '';

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
  -- Ngày làm việc thứ mấy kể từ ngày gửi, theo mẫu
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    else array[1, 1, 2, 3, 3, 3] end;
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  start date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  target date;
  i int;
  k int;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;
  for i in 1 .. array_length(roles, 1) loop
    skipped := roles[i] <> 'pic' and jsonb_array_length(coalesce(deps -> roles[i], '[]'::jsonb)) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    target := start;
    for k in 1 .. days[i] loop target := private.next_workday(target); end loop;
    insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
    values (p_type, p_doc, p_project, i, roles[i], target, case when skipped then 'skipped' else 'pending' end);
  end loop;
end;
$$;

create or replace function public.procurement_my_departments()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r), '{}') from unnest(array['leader', 'technical', 'material', 'accounting', 'admin_office']) r where (select private.in_department(r));
$$;

-- Hành chánh phát hành PO chính thức cho đơn dự án đã được Lãnh đạo duyệt; ký luôn bước Hành chánh nếu đang chờ.
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
  if not (select private.is_admin()) and not (select private.in_department('admin_office')) then raise exception 'FORBIDDEN'; end if;
  if not o.uses_chain or o.status <> 'approved' or o.po_issued_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  if char_length(btrim(coalesce(p_supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  po := 'PO-' || (select code from public.projects where id = o.project_id) || '-'
    || lpad(((select count(*) from public.purchase_orders where project_id = o.project_id and po_no <> '') + 1)::text, 3, '0');
  update public.purchase_orders set po_no = po, po_issued_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')) where id = p_order;
  update public.approval_steps set result = 'signed', signer_id = auth.uid(), signer_name = coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    note = 'Phát hành ' || po, acted_at = now()
    where doc_type = 'purchase' and doc_id = p_order and role = 'admin_office' and result = 'pending';
  perform private.purchase_log(p_order, 'issue_po', po || ' · ' || btrim(p_supplier));
  return po;
end;
$$;

-- NCC đã ký bản sao PO gửi lại: PO có hiệu lực.
create or replace function public.purchase_supplier_accept(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.requester_id <> auth.uid() and not (select private.is_admin()) and not (select private.is_purchase_approver()) and not (select private.in_department('admin_office'))
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id))) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'approved' or o.po_issued_at is null or o.supplier_accepted_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  update public.purchase_orders set supplier_accepted_at = now(), supplier_accept_note = btrim(coalesce(p_note, '')) where id = p_order;
  perform private.purchase_log(p_order, 'supplier_accept', btrim(coalesce(p_note, '')));
end;
$$;

-- Đặt hàng: đơn dự án cần PO đã được NCC ký nhận; NCC cần tạm ứng thì tạm ứng đã chi.
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
  if o.uses_chain and o.po_issued_at is null then raise exception 'PO_NOT_ISSUED'; end if;
  if o.uses_chain and o.supplier_accepted_at is null then raise exception 'PO_NOT_ACCEPTED'; end if;
  if o.advance_required and not exists (select 1 from public.purchase_payments where order_id = p_order and kind = 'advance' and status = 'paid') then raise exception 'PO_ADVANCE_NOT_PAID'; end if;
  update public.purchase_orders set status = 'ordered', ordered_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')), expected_delivery = p_expected
    where id = p_order;
  perform private.purchase_log(p_order, 'order', concat_ws(' · ', btrim(p_supplier), case when p_expected is not null then 'giao dự kiến ' || to_char(p_expected, 'DD/MM/YYYY') end, nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

-- Đề nghị tạm ứng của đơn dự án chỉ sau khi PO đã được NCC ký nhận.
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
  if o.uses_chain and p_kind = 'advance' and o.po_issued_at is null then raise exception 'PO_NOT_ISSUED'; end if;
  if o.uses_chain and p_kind = 'advance' and o.supplier_accepted_at is null then raise exception 'PO_NOT_ACCEPTED'; end if;
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

-- Nhận hàng kèm biên bản giao nhận; đơn dự án bắt buộc số biên bản đã có chữ ký hai bên. Hàm cũ chỉ gọi qua hàm này.
create or replace function public.purchase_receive_record(p_order uuid, p_items jsonb, p_note text, p_record_no text, p_signed_both boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders;
begin
  select * into o from public.purchase_orders where id = p_order;
  if not found or not (select private.can_view_purchase(p_order)) then raise exception 'PO_NOT_FOUND'; end if;
  if o.uses_chain and (char_length(btrim(coalesce(p_record_no, ''))) < 1 or not coalesce(p_signed_both, false)) then raise exception 'PO_RECEIPT_RECORD_REQUIRED'; end if;
  perform public.purchase_receive(p_order, p_items,
    concat_ws(' · ', case when btrim(coalesce(p_record_no, '')) <> '' then 'Biên bản giao nhận ' || btrim(p_record_no) || case when p_signed_both then ' (hai bên đã ký)' else '' end end, nullif(btrim(coalesce(p_note, '')), '')));
  if btrim(coalesce(p_record_no, '')) <> '' then
    perform set_config('tnm.purchase_rpc', 'on', true);
    update public.purchase_orders set receipt_record_no = btrim(p_record_no) where id = p_order;
  end if;
end;
$$;

revoke execute on function public.purchase_receive(uuid, jsonb, text) from authenticated;
revoke all on function public.procurement_my_departments(), public.purchase_issue_po(uuid, text, text), public.purchase_supplier_accept(uuid, text),
  public.purchase_receive_record(uuid, jsonb, text, text, boolean) from public, anon;
grant execute on function public.procurement_my_departments(), public.purchase_issue_po(uuid, text, text), public.purchase_supplier_accept(uuid, text),
  public.purchase_receive_record(uuid, jsonb, text, text, boolean) to authenticated;
