-- Sửa lỗi không tạo được đơn hàng ("Bạn không có quyền…" / new row violates RLS):
-- insert … returning cần qua quy tắc đọc, mà private.can_view_purchase(id) dò lại bảng bằng truy vấn con nên chưa thấy dòng vừa thêm.
-- Quy tắc đọc kiểm tra thẳng cột requester_id (và Admin) trước. Admin sửa / xóa được đơn nháp của mọi người để tự test.

drop policy if exists "purchase_orders: đọc" on public.purchase_orders;
create policy "purchase_orders: đọc" on public.purchase_orders for select to authenticated
  using (requester_id = (select auth.uid()) or (select private.is_admin()) or (select private.can_view_purchase(id)));

create or replace function private.can_edit_purchase_draft(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.purchase_orders o where o.id = oid and o.status in ('draft', 'rejected')
    and (o.requester_id = (select auth.uid()) or (select private.is_admin())));
$$;

drop policy if exists "purchase_orders: sửa nháp" on public.purchase_orders;
create policy "purchase_orders: sửa nháp" on public.purchase_orders for update to authenticated
  using ((select private.can_edit_purchase_draft(id)))
  with check ((requester_id = (select auth.uid()) or (select private.is_admin())) and (select private.can_request_purchase(kind, project_id)));

drop policy if exists "purchase_orders: xóa nháp" on public.purchase_orders;
create policy "purchase_orders: xóa nháp" on public.purchase_orders for delete to authenticated
  using (status = 'draft' and (requester_id = (select auth.uid()) or (select private.is_admin())));
