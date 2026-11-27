-- YCVT ↔ PO nháp: mỗi hạng mục (mã ngân sách) của một phiếu YCVT ứng với đúng một PO nháp.
-- 1) material_group_to_order: lập PO nháp trống (chưa NCC, chưa đơn giá) cho một hạng mục của phiếu đã duyệt.
-- 2) material_quote_to_orders: chọn báo giá thì ĐIỀN vào PO nháp sẵn có của từng hạng mục (thay dòng, NCC);
--    hạng mục đã có đơn đi quá bước nháp thì bỏ qua; hạng mục chưa có PO thì lập mới như trước.
-- Phiếu chuyển "Đã lên đơn" khi mọi hạng mục đã có PO (đơn đã hủy không tính). PO lập tay không cần YCVT vẫn như cũ.

create or replace function private.material_all_grouped(p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.material_request_items i
    join public.material_requests r on r.id = i.request_id
    where i.request_id = p_request
      and (r.project_id is null or i.budget_code is not null)
      and not exists (
        select 1 from public.purchase_orders o
        where o.material_request_id = p_request and o.status <> 'cancelled'
          and (r.project_id is null or o.budget_code = i.budget_code)))
$$;
revoke all on function private.material_all_grouped(uuid) from public, anon;
grant execute on function private.material_all_grouped(uuid) to authenticated;

create or replace function public.material_group_to_order(p_request uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  office boolean;
  code text;
  n int;
  first_name text;
  needed date;
  new_order uuid;
begin
  select * into r from public.material_requests where id = p_request for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('approved', 'ordered') then raise exception 'MR_NOT_APPROVED'; end if;
  if not (select private.can_quote(r.project_id)) then raise exception 'FORBIDDEN'; end if;
  office := r.project_id is null;
  code := case when office then null else nullif(btrim(coalesce(p_code, '')), '') end;
  if not office and code is null then raise exception 'MR_ITEM_CODE_REQUIRED'; end if;
  select count(*), (array_agg(i.name order by i.sort))[1], min(i.needed_on) into n, first_name, needed
  from public.material_request_items i
  where i.request_id = p_request and (office or i.budget_code = code);
  if n = 0 then raise exception 'MR_GROUP_EMPTY'; end if;
  if exists (select 1 from public.purchase_orders o where o.material_request_id = p_request and o.status <> 'cancelled' and (office or o.budget_code = code)) then
    raise exception 'MR_GROUP_HAS_ORDER';
  end if;

  insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, note, status, material_request_id)
  values ('tam', case when office then 'office' else 'project' end, r.project_id, code,
    left(r.number || ' · ' || case when n = 1 then first_name else first_name || ' và ' || (n - 1) || ' mục khác' end, 200),
    needed, case when office then '' else coalesce((select p.site from public.projects p where p.id = r.project_id), '') end,
    'Theo phiếu ' || r.number, 'draft', p_request)
  returning id into new_order;
  insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
  select new_order, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, 0
  from public.material_request_items i
  where i.request_id = p_request and (office or i.budget_code = code);
  perform private.purchase_log(new_order, 'create', 'Lập PO nháp từ ' || r.number || coalesce(' · hạng mục ' || code, ''));
  if private.material_all_grouped(p_request) then update public.material_requests set status = 'ordered' where id = p_request; end if;
  return new_order;
end;
$$;

create or replace function public.material_quote_to_orders(p_request uuid, p_quote uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  q public.material_quotes;
  office boolean;
  addr text;
  code_row record;
  existing public.purchase_orders;
  target uuid;
  ids uuid[] := '{}';
begin
  select * into r from public.material_requests where id = p_request for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('approved', 'ordered') then raise exception 'MR_NOT_APPROVED'; end if;
  if not (select private.can_quote(r.project_id)) then raise exception 'FORBIDDEN'; end if;
  office := r.project_id is null;
  select * into q from public.material_quotes where id = p_quote and request_id = p_request for update;
  if not found then raise exception 'MR_QUOTE_NOT_FOUND'; end if;
  if q.selected then raise exception 'MR_QUOTE_USED'; end if;
  if not exists (select 1 from public.material_request_items i where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0) then raise exception 'MR_QUOTE_EMPTY'; end if;
  if not office and exists (select 1 from public.material_request_items i where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0 and i.budget_code is null) then raise exception 'MR_ITEM_CODE_REQUIRED'; end if;
  addr := case when office then '' else coalesce((select p.site from public.projects p where p.id = r.project_id), '') end;

  for code_row in
    select g.code, count(*) as n, (array_agg(g.name order by g.sort))[1] as first_name, min(g.needed_on) as needed
    from (select case when office then null else i.budget_code end as code, i.name, i.sort, i.needed_on
          from public.material_request_items i
          where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0) g
    group by g.code order by g.code nulls first
  loop
    select * into existing from public.purchase_orders o
    where o.material_request_id = p_request and o.status <> 'cancelled' and (office or o.budget_code = code_row.code)
    order by o.created_at limit 1;

    if found and existing.status <> 'draft' then
      continue; -- hạng mục đã có đơn đi quá bước nháp: không đụng tới
    elsif found then
      target := existing.id;
      update public.purchase_orders set supplier = q.supplier, supplier_contact = q.supplier_contact,
        note = btrim(concat_ws(' · ', 'Theo phiếu ' || r.number, nullif('báo giá ' || q.quote_ref, 'báo giá '), nullif('ĐK thanh toán: ' || q.payment_terms, 'ĐK thanh toán: ')))
      where id = target;
      delete from public.purchase_items where order_id = target;
      perform private.purchase_log(target, 'update', 'Điền báo giá ' || q.supplier || ' từ ' || r.number);
    else
      insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, supplier, supplier_contact, note, status, material_request_id)
      values ('tam', case when office then 'office' else 'project' end, r.project_id, code_row.code,
        left(r.number || ' · ' || case when code_row.n = 1 then code_row.first_name else code_row.first_name || ' và ' || (code_row.n - 1) || ' mục khác' end, 200),
        code_row.needed, addr, q.supplier, q.supplier_contact,
        btrim(concat_ws(' · ', 'Theo phiếu ' || r.number, nullif('báo giá ' || q.quote_ref, 'báo giá '), nullif('ĐK thanh toán: ' || q.payment_terms, 'ĐK thanh toán: '))),
        'draft', p_request)
      returning id into target;
      perform private.purchase_log(target, 'create', 'Lập từ ' || r.number || ' · ' || q.supplier);
    end if;

    insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
    select target, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, (q.prices ->> i.id::text)::numeric
    from public.material_request_items i
    where i.request_id = p_request and (office or i.budget_code is not distinct from code_row.code) and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0;
    update public.purchase_orders set total_estimate = (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = target) where id = target;
    ids := ids || target;
  end loop;

  if cardinality(ids) = 0 then raise exception 'MR_GROUPS_ALL_ORDERED'; end if;
  update public.material_quotes set selected = true where id = p_quote;
  if private.material_all_grouped(p_request) then update public.material_requests set status = 'ordered' where id = p_request; end if;
  return ids;
end;
$$;

revoke all on function public.material_group_to_order(uuid, text) from public, anon;
grant execute on function public.material_group_to_order(uuid, text) to authenticated;
