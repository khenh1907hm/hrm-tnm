-- Người được giao ký theo NHÓM ("any:<id1>,<id2>", cây khối duyệt) không xem được đơn / đề nghị thanh toán dự án,
-- nên bấm ký báo PO_NOT_FOUND (approval_sign khóa đơn qua can_view_purchase). Trước đây chỉ khớp bước giao đúng một người.
create or replace function private.can_view_purchase(oid uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.purchase_orders o
    where o.id = oid and (
      o.requester_id = (select auth.uid())
      or (select private.is_admin())
      or (select private.is_director())
      or (o.project_id is null and (
        (select private.is_purchase_approver())
        or (select private.has_access('purchases.view'))
        or (select private.is_purchase_payer())
        or (select private.in_any_department())
      ))
      or (o.project_id is not null and (
        (select private.is_project_insider(o.project_id))
        or (select private.in_department('leader'))
        or (select private.in_department('material'))
        or (select private.in_department('warehouse'))
        or (select private.in_department('accounting'))
        or exists (
          select 1 from public.approval_steps s
          where (s.doc_id = o.id or s.doc_id in (select pp.id from public.purchase_payments pp where pp.order_id = o.id))
            and ((s.signer_id)::text = (select auth.uid())::text
              or (s.assignee_employee_id)::text = (select private.my_employee_id())::text
              or (s.assignee_employee_id like 'any:%'
                and (select private.my_employee_id()) = any (string_to_array(substr(s.assignee_employee_id, 5), ','))))
        )
      ))
    )
  );
$function$;
