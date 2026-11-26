-- Đơn mua hàng của dự án chỉ người liên quan tới đúng dự án đó mới xem được.
-- Trước: ai thuộc bất kỳ phòng ban nào, có quyền purchases.view mặc định (HR) hay có tên trong cây duyệt chung
-- đều xem được đơn của mọi dự án.
-- Sau (đơn dự án): người lập, Admin, Giám đốc, thành viên dự án (trừ công nhân), PM / chỉ huy, người duyệt của
-- chính dự án, người có bước ký trên đơn / đề nghị thanh toán của đơn, và các phòng xử lý đơn
-- (Lãnh đạo, Vật tư, Kho, Kế toán). Đơn văn phòng giữ như cũ.

create or replace function private.is_project_insider(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pid is not null and (
    (select private.is_project_pm(pid))
    or (select private.is_project_lead(pid))
    or ((select private.my_employee_id()) is not null and (
      exists (select 1 from public.project_members m
              where m.project_id = pid and m.role <> 'worker' and m.employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_approvers a where a.project_id = pid and a.employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_approval_trees t, jsonb_array_elements(t.blocks) b, jsonb_array_elements_text(coalesce(b -> 'people', '[]'::jsonb)) p(id)
                 where t.project_id = pid and p.id = (select private.my_employee_id()::text))
    ))
  );
$$;

create or replace function private.can_view_purchase(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
            and ((s.signer_id)::text = (select auth.uid())::text or (s.assignee_employee_id)::text = (select private.my_employee_id())::text)
        )
      ))
    )
  );
$$;

revoke all on function private.is_project_insider(uuid) from public, anon;
grant execute on function private.is_project_insider(uuid) to authenticated;
