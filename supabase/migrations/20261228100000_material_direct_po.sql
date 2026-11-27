-- YCVT bỏ các bước ký duyệt / hỏi giá: lập phiếu xong (bấm "Lưu và lập PO nháp") là ra PO nháp (POD) ngay,
-- mỗi hạng mục (mã ngân sách) một PO; dòng chưa có mã gộp thành một PO chưa có mã (P. Vật tư chọn mã trong PO trước khi gửi duyệt).
-- Văn phòng: cả phiếu một PO. Phiếu chuyển thẳng "Đã lên đơn". PO nháp đi tiếp chuỗi ký của PO như cũ.

-- Lập một PO nháp trống cho một nhóm dòng của phiếu (mã null = nhóm chưa có mã); dùng chung cho gửi phiếu và nút "Lập PO nháp".
create or replace function private.material_make_order(p_request uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  office boolean;
  n int;
  first_name text;
  needed date;
  new_order uuid;
begin
  select * into r from public.material_requests where id = p_request;
  office := r.project_id is null;
  select count(*), (array_agg(i.name order by i.sort))[1], min(i.needed_on) into n, first_name, needed
  from public.material_request_items i
  where i.request_id = p_request and (office or i.budget_code is not distinct from p_code);
  if n = 0 then raise exception 'MR_GROUP_EMPTY'; end if;
  if exists (select 1 from public.purchase_orders o where o.material_request_id = p_request and o.status <> 'cancelled' and (office or o.budget_code is not distinct from p_code)) then
    raise exception 'MR_GROUP_HAS_ORDER';
  end if;
  insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, note, status, material_request_id)
  values ('tam', case when office then 'office' else 'project' end, r.project_id, case when office then null else p_code end,
    left(r.number || ' · ' || case when n = 1 then first_name else first_name || ' và ' || (n - 1) || ' mục khác' end, 200),
    needed, case when office then '' else coalesce((select p.site from public.projects p where p.id = r.project_id), '') end,
    'Theo phiếu ' || r.number, 'draft', p_request)
  returning id into new_order;
  insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
  select new_order, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, 0
  from public.material_request_items i
  where i.request_id = p_request and (office or i.budget_code is not distinct from p_code);
  perform private.purchase_log(new_order, 'create', 'Lập PO nháp từ ' || r.number || coalesce(' · hạng mục ' || p_code, ''));
  return new_order;
end;
$$;
revoke all on function private.material_make_order(uuid, text) from public, anon;

-- Mọi dòng (kể cả dòng chưa có mã) đã nằm trong một PO chưa hủy
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
      and not exists (
        select 1 from public.purchase_orders o
        where o.material_request_id = p_request and o.status <> 'cancelled'
          and (r.project_id is null or o.budget_code is not distinct from i.budget_code)))
$$;

-- Gửi phiếu = lập PO nháp cho từng hạng mục ngay (không còn chuỗi ký YCVT, không hỏi giá ở phiếu)
create or replace function public.material_request_submit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  g record;
begin
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('draft', 'rejected') then raise exception 'MR_BAD_STATUS'; end if;
  if not (r.requester_id = auth.uid() or (select private.is_project_lead(r.project_id)) or (select private.in_department('material')) or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.material_request_items where request_id = p_id) then raise exception 'MR_NO_ITEMS'; end if;
  if exists (select 1 from public.material_request_items where request_id = p_id and btrim(unit) = '') then raise exception 'MR_UNIT_REQUIRED'; end if;
  update public.material_requests set status = 'ordered', submitted_at = now(), approved_at = now() where id = p_id;
  for g in
    select distinct case when r.project_id is null then null else i.budget_code end as code
    from public.material_request_items i where i.request_id = p_id
    order by 1 nulls last
  loop
    if not exists (select 1 from public.purchase_orders o where o.material_request_id = p_id and o.status <> 'cancelled' and (r.project_id is null or o.budget_code is not distinct from g.code)) then
      perform private.material_make_order(p_id, g.code);
    end if;
  end loop;
end;
$$;

-- Nút "Lập PO nháp" cho một hạng mục còn thiếu PO (phiếu cũ, hoặc PO đã hủy); nhận cả nhóm chưa có mã (p_code null)
create or replace function public.material_group_to_order(p_request uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  new_order uuid;
begin
  select * into r from public.material_requests where id = p_request for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('submitted', 'approved', 'ordered') then raise exception 'MR_NOT_APPROVED'; end if;
  if not (select private.can_quote(r.project_id)) and not (r.requester_id = auth.uid() or (select private.is_project_lead(r.project_id))) then raise exception 'FORBIDDEN'; end if;
  new_order := private.material_make_order(p_request, nullif(btrim(coalesce(p_code, '')), ''));
  if private.material_all_grouped(p_request) then update public.material_requests set status = 'ordered', approved_at = coalesce(approved_at, now()) where id = p_request; end if;
  return new_order;
end;
$$;
