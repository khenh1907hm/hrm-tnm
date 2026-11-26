-- 1) Tệp đính kèm theo từng bước của đơn hàng: PO có NCC ký, theo dõi / ảnh đơn hàng, biên bản giao nhận & ảnh nhận hàng,
--    phiếu nhập kho & ảnh kho, hóa đơn / chứng từ, chứng từ chi (UNC), khác.
alter table public.purchase_attachments drop constraint if exists purchase_attachments_kind_check;
alter table public.purchase_attachments add constraint purchase_attachments_kind_check check (kind = any (array[
  'signed_quote', 'price_comparison', 'tnm_quote', 'master_schedule', 'drawing',
  'po_signed', 'tracking', 'delivery', 'stock', 'docs', 'payment_proof', 'other'
]));

-- 2) Nhắc người lập đơn trước ngày giao (để người lập nhắc NCC): còn 3 ngày, 1 ngày, đúng ngày, và mỗi ngày khi quá hẹn.
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind = any (array[
  'approval_pending', 'approval_returned', 'approval_approved', 'bug_report', 'delivery_due'
]));

create or replace function public.purchase_delivery_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  made integer := 0;
  rec record;
  days integer;
  head text;
begin
  for rec in
    select o.id, o.code, o.po_no, o.title, o.supplier, o.requester_id, o.project_id, o.status,
           coalesce(o.expected_delivery, o.needed_by) as due
    from public.purchase_orders o
    where o.status in ('approved', 'ordered') and coalesce(o.expected_delivery, o.needed_by) is not null and o.requester_id is not null
  loop
    days := rec.due - today;
    if days not in (3, 1, 0) and days >= 0 then continue; end if;
    if exists (select 1 from public.user_notifications n where n.kind = 'delivery_due' and n.doc_id = rec.id and n.user_id = rec.requester_id
               and (n.created_at at time zone 'Asia/Ho_Chi_Minh')::date = today) then continue; end if;
    head := case when days > 0 then format('Còn %s ngày tới hạn giao %s', days, coalesce(nullif(rec.po_no, ''), rec.code))
                 when days = 0 then format('Hôm nay là hạn giao %s', coalesce(nullif(rec.po_no, ''), rec.code))
                 else format('%s quá hạn giao %s ngày', coalesce(nullif(rec.po_no, ''), rec.code), -days) end;
    insert into public.user_notifications (user_id, kind, doc_type, doc_id, project_id, title, body, link)
    values (rec.requester_id, 'delivery_due', 'purchase', rec.id, rec.project_id, head,
            format('%s · NCC %s · hạn %s. Nhắc nhà cung cấp giao đúng hẹn, cập nhật theo dõi trong đơn.', rec.title, coalesce(nullif(rec.supplier, ''), '—'), to_char(rec.due, 'DD/MM/YYYY')),
            case when rec.project_id is not null then format('/du-an/%s?muc=dat-hang&don=%s', rec.project_id, rec.id) else format('/dat-hang/%s', rec.id) end);
    made := made + 1;
  end loop;
  return made;
end;
$$;

revoke all on function public.purchase_delivery_reminders() from public, anon, authenticated;
grant execute on function public.purchase_delivery_reminders() to service_role;
