-- Siết thời điểm tạm ứng / thanh toán đúng điều kiện đã chọn trên PO:
-- 1) Tạm ứng không vượt % tạm ứng đã chốt (PO_ADVANCE_OVER_PCT).
-- 2) "Thanh toán trước khi nhận hàng": phải chi xong đề nghị thanh toán trước giao mới được nhận hàng (PO_PREPAY_NOT_PAID);
--    đã nhận hàng thì không lập đề nghị "thanh toán trước giao" nữa (PO_PREPAY_TOO_LATE).
-- 3) Thanh toán còn lại / thanh toán sau nhận hàng: chỉ sau khi nhận hàng, và đơn dự án phải thu đủ chứng từ (PO_FINAL_TOO_EARLY).

create or replace function public.purchase_request_rfp(p_order uuid, p_kind text, p_amount bigint, p_vat bigint, p_invoice_no text, p_invoice_date date, p_payee text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  pid uuid;
  rfp text;
  basis bigint;
  advanced bigint;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_purchase_payer()) and not (select private.is_admin())
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id))) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('advance', 'prepayment', 'final') then raise exception 'PO_BAD_PAYMENT'; end if;
  if o.status not in ('approved', 'ordered', 'received') then raise exception 'PO_BAD_STATUS'; end if;
  if o.uses_chain and ((p_kind = 'advance' and not o.advance_required) or (p_kind = 'prepayment' and not o.prepay_required)) then raise exception 'PO_PAYMENT_NOT_NEEDED'; end if;
  if o.uses_chain and p_kind = 'advance' and o.po_issued_at is null then raise exception 'PO_NOT_ISSUED'; end if;
  if o.uses_chain and p_kind = 'advance' and o.supplier_accepted_at is null then raise exception 'PO_NOT_ACCEPTED'; end if;
  if p_kind = 'prepayment' and o.status = 'received' then raise exception 'PO_PREPAY_TOO_LATE'; end if;
  if p_kind = 'final' and (o.status <> 'received' or (o.uses_chain and o.docs_collected_at is null)) then raise exception 'PO_FINAL_TOO_EARLY'; end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(p_vat, 0) < 0 then raise exception 'PO_BAD_AMOUNT'; end if;
  if p_kind <> 'advance' and char_length(btrim(coalesce(p_invoice_no, ''))) < 1 then raise exception 'PO_INVOICE_REQUIRED'; end if;
  basis := coalesce(o.total_actual, o.total_estimate);
  if (select coalesce(sum(amount), 0) from public.purchase_payments where order_id = p_order and status <> 'rejected') + p_amount > basis then
    raise exception 'PO_PAY_OVER';
  end if;
  if p_kind = 'advance' and coalesce(o.advance_pct, 0) > 0 then
    advanced := (select coalesce(sum(amount), 0) from public.purchase_payments where order_id = p_order and kind = 'advance' and status <> 'rejected');
    if advanced + p_amount > round(basis * o.advance_pct / 100) then raise exception 'PO_ADVANCE_OVER_PCT'; end if;
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
$function$;

create or replace function public.purchase_receive(p_order uuid, p_items jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  item jsonb;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin())
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id)))
    and not (select private.can_do_stage('received', p_order)) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('ordered', 'received') then raise exception 'PO_BAD_STATUS'; end if;
  if o.stocked_at is not null then raise exception 'PO_ALREADY_STOCKED'; end if;
  -- Thanh toán trước khi nhận hàng: phải chi xong đề nghị thanh toán trước giao
  if o.status = 'ordered' and o.prepay_required
    and not exists (select 1 from public.purchase_payments where order_id = p_order and kind = 'prepayment' and status = 'paid') then
    raise exception 'PO_PREPAY_NOT_PAID';
  end if;
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.purchase_items set
      received_qty = greatest(0, (item ->> 'receivedQty')::numeric),
      accepted_qty = least(greatest(0, (item ->> 'acceptedQty')::numeric), greatest(0, (item ->> 'receivedQty')::numeric)),
      inspection_note = btrim(coalesce(item ->> 'note', ''))
      where id = (item ->> 'id')::uuid and order_id = p_order;
  end loop;
  update public.purchase_orders set status = 'received', received_at = coalesce(received_at, now()),
    total_actual = (select coalesce(sum(round(accepted_qty * unit_price)), 0)::bigint from public.purchase_items where order_id = p_order)
    where id = p_order;
  perform private.purchase_log(p_order, 'receive', p_note);
end;
$function$;
