-- Giai đoạn mua hàng theo phòng ban + bước Nhập kho:
--  * Quy trình đơn hàng: Đơn hàng nháp → Lập đơn hàng → Duyệt → PO → Tạm ứng → Thực hiện chi tạm ứng → Theo dõi đơn hàng
--    → Thanh toán trước nhận hàng → Thực hiện chi TT trước → Nhận hàng, kiểm đếm → NHẬP KHO → Thu thập chứng từ & thanh toán
--    → Thực hiện chi TT sau nhận hàng → Thành công / Thất bại.
--  * procurement_settings.stage_departments: phòng ban phụ trách từng giai đoạn (Admin / Giám đốc chỉnh ở trang "Quy trình duyệt").
--  * Nhận hàng, Nhập kho, Thu thập chứng từ: người thuộc phòng ban được giao (của dự án hoặc chung) làm được; Hoàn tất đơn cần đã nhập kho và đủ chứng từ.

alter table public.procurement_settings add column if not exists stage_departments jsonb not null default '{}'::jsonb
  check (jsonb_typeof(stage_departments) = 'object');
comment on column public.procurement_settings.stage_departments is
  'Phòng ban phụ trách từng giai đoạn đơn hàng: {stage: pic|technical|material|warehouse|accounting|leader|""}.';

alter table public.purchase_orders
  add column if not exists stocked_at timestamptz,
  add column if not exists stock_receipt_no text not null default '',
  add column if not exists stock_location text not null default '',
  add column if not exists stock_note text not null default '',
  add column if not exists stocked_by_name text not null default '',
  add column if not exists docs_collected_at timestamptz,
  add column if not exists docs_note text not null default '';

-- Đơn đã hoàn tất trước đây: coi như đã nhập kho, đủ chứng từ
update public.purchase_orders set stocked_at = coalesce(stocked_at, completed_at), docs_collected_at = coalesce(docs_collected_at, completed_at)
where status = 'completed';

-- Phòng ban mặc định của từng giai đoạn
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
      when 'draft' then 'pic' when 'submitted' then 'pic' when 'approved' then 'leader' when 'po' then 'material'
      when 'advance' then 'material' when 'advance_pay' then 'accounting' when 'ordered' then 'material'
      when 'prepayment' then 'material' when 'prepayment_pay' then 'accounting' when 'received' then 'warehouse'
      when 'stocked' then 'warehouse' when 'final' then 'material' when 'final_pay' then 'accounting' else '' end);
$$;

-- Người đăng nhập làm được giai đoạn p_stage của đơn p_order không (theo phòng ban được giao).
create or replace function private.can_do_stage(p_stage text, p_order uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders;
  dep text := private.stage_department(p_stage);
begin
  select * into o from public.purchase_orders where id = p_order;
  if not found then return false; end if;
  if (select private.is_admin()) or (select private.is_director()) then return true; end if;
  if dep = 'pic' then
    return o.requester_id = auth.uid() or (o.project_id is not null and ((select private.is_project_lead(o.project_id)) or (select private.holds_step_strict('pic', o.project_id, null))));
  end if;
  if dep in ('technical', 'material', 'warehouse', 'accounting', 'leader') then
    return (select private.in_department(dep)) or (o.project_id is not null and (select private.holds_step_strict(dep, o.project_id, null)));
  end if;
  return false;
end;
$$;
revoke all on function private.stage_department(text), private.can_do_stage(text, uuid) from public, anon;
grant execute on function private.stage_department(text), private.can_do_stage(text, uuid) to authenticated;

-- Bảng phòng ban theo giai đoạn (đã gộp mặc định) cho giao diện
create or replace function public.purchase_stage_departments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(k, (select private.stage_department(k)))
  from unnest(array['draft', 'submitted', 'approved', 'po', 'advance', 'advance_pay', 'ordered', 'prepayment', 'prepayment_pay',
    'received', 'stocked', 'final', 'final_pay']) k;
$$;

-- Các giai đoạn của đơn mà người đăng nhập làm được
create or replace function public.purchase_stage_permissions(p_order uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when not (select private.can_view_purchase(p_order)) then '{}'::text[] else
    coalesce((select array_agg(k) from unnest(array['received', 'stocked', 'final']) k where (select private.can_do_stage(k, p_order))), '{}') end;
$$;

-- Nhận hàng, kiểm đếm: thêm người của phòng ban được giao (mặc định Kho)
create or replace function public.purchase_receive(p_order uuid, p_items jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  item jsonb;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin())
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id)))
    and not (select private.can_do_stage('received', p_order)) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('ordered', 'received') then raise exception 'PO_BAD_STATUS'; end if;
  if o.stocked_at is not null then raise exception 'PO_ALREADY_STOCKED'; end if;
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
$$;
revoke execute on function public.purchase_receive(uuid, jsonb, text) from public, anon, authenticated;

-- Nhập kho: phiếu nhập kho (tự cấp số nếu để trống), vị trí kho
create or replace function public.purchase_stock_in(p_order uuid, p_receipt_no text, p_location text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  no text;
begin
  if not (select private.can_do_stage('stocked', p_order)) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'received' or o.stocked_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  no := coalesce(nullif(btrim(coalesce(p_receipt_no, '')), ''), 'PNK-' || o.code);
  update public.purchase_orders set stocked_at = now(), stock_receipt_no = no, stock_location = btrim(coalesce(p_location, '')),
    stock_note = btrim(coalesce(p_note, '')),
    stocked_by_name = coalesce((select full_name from public.profiles where id = auth.uid()), '')
  where id = p_order;
  perform private.purchase_log(p_order, 'stock_in', concat_ws(' · ', no, nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_note, '')), '')));
  return no;
end;
$$;

-- Thu thập chứng từ (hóa đơn GTGT, biên bản giao nhận, phiếu nhập kho, CO/CQ…): sau khi nhập kho
create or replace function public.purchase_collect_docs(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if not (select private.can_do_stage('final', p_order)) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'received' or o.docs_collected_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  if o.stocked_at is null then raise exception 'PO_NOT_STOCKED'; end if;
  update public.purchase_orders set docs_collected_at = now(), docs_note = btrim(coalesce(p_note, '')) where id = p_order;
  perform private.purchase_log(p_order, 'collect_docs', p_note);
end;
$$;

-- Hoàn tất (Thành công): cần đã nhập kho và đủ chứng từ
create or replace function public.purchase_complete(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  eid uuid;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin())
    and not (select private.can_do_stage('final', p_order)) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'received' then raise exception 'PO_BAD_STATUS'; end if;
  if o.stocked_at is null then raise exception 'PO_NOT_STOCKED'; end if;
  if o.docs_collected_at is null then raise exception 'PO_DOCS_NOT_COLLECTED'; end if;
  if exists (select 1 from public.purchase_payments where order_id = p_order and status in ('requested', 'approved')) then raise exception 'PO_PAYMENTS_PENDING'; end if;
  if o.kind = 'project' and coalesce(o.total_actual, 0) > 0 then
    insert into public.project_expenses (project_id, spent_on, category, description, supplier, amount, status, created_by)
    values (o.project_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'material', left('Đơn hàng ' || o.code || ': ' || o.title, 500), o.supplier, o.total_actual, 'approved', auth.uid())
    returning id into eid;
  end if;
  update public.purchase_orders set status = 'completed', completed_at = now(), expense_id = eid where id = p_order;
  perform private.purchase_log(p_order, 'complete', p_note);
end;
$$;

-- Lưu cấu hình: thêm phòng ban theo giai đoạn
drop function if exists public.approval_settings_save(jsonb, jsonb);
create or replace function public.approval_settings_save(p_departments jsonb, p_modes jsonb, p_stages jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_departments, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_modes, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_stages, '{}'::jsonb)) <> 'object' then raise exception 'BAD_INPUT'; end if;
  update public.procurement_settings set departments = coalesce(p_departments, departments),
    modes = case when p_modes is null then modes else
      (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_modes) x(k, v) where v in ('any', 'sequence')) end,
    stage_departments = case when p_stages is null then stage_departments else
      (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_stages) x(k, v)
       where k in ('draft', 'submitted', 'approved', 'po', 'advance', 'advance_pay', 'ordered', 'prepayment', 'prepayment_pay', 'received', 'stocked', 'final', 'final_pay')
         and v in ('', 'pic', 'technical', 'material', 'warehouse', 'accounting', 'leader')) end,
    updated_at = now()
  where id = 1;
  perform private.log_event('approval.settings', 'procurement_settings', '1', jsonb_build_object('departments', p_departments, 'modes', p_modes, 'stages', p_stages));
end;
$$;

revoke all on function public.purchase_stage_departments(), public.purchase_stage_permissions(uuid), public.purchase_stock_in(uuid, text, text, text),
  public.purchase_collect_docs(uuid, text), public.purchase_complete(uuid, text), public.approval_settings_save(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.purchase_stage_departments(), public.purchase_stage_permissions(uuid), public.purchase_stock_in(uuid, text, text, text),
  public.purchase_collect_docs(uuid, text), public.purchase_complete(uuid, text), public.approval_settings_save(jsonb, jsonb, jsonb) to authenticated;
