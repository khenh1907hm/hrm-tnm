-- Văn phòng: quỹ theo năm (không chia hạng mục) và Yêu cầu vật tư (YCVT-VP-NNN) đi chuỗi ký rồi lên đơn nháp như dự án.

-- 1. Quỹ văn phòng theo năm: Admin / Giám đốc đặt số tiền; đã dùng = tổng các đơn văn phòng của năm (tính ở ứng dụng)
create table if not exists public.office_funds (
  year smallint primary key check (year between 2000 and 2100),
  amount bigint not null default 0 check (amount >= 0),
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.office_funds enable row level security;
drop policy if exists "office_funds: đọc" on public.office_funds;
create policy "office_funds: đọc" on public.office_funds for select to authenticated using (true);

create or replace function public.office_fund_set(p_year integer, p_amount bigint, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 or p_amount is null or p_amount < 0 then raise exception 'BUDGET_BAD_AMOUNT'; end if;
  insert into public.office_funds (year, amount, note, updated_at, updated_by)
  values (p_year, p_amount, left(btrim(coalesce(p_note, '')), 300), now(), auth.uid())
  on conflict (year) do update set amount = excluded.amount, note = excluded.note, updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.office_fund_set(integer, bigint, text) from public, anon;
grant execute on function public.office_fund_set(integer, bigint, text) to authenticated;

-- 2. YCVT văn phòng: phiếu không thuộc dự án
alter table public.material_requests alter column project_id drop not null;

drop policy if exists "material_requests: đọc" on public.material_requests;
create policy "material_requests: đọc" on public.material_requests for select to authenticated
  using ((select private.can_view_material(project_id)) or requester_id = (select auth.uid()));
drop policy if exists "material_request_items: đọc" on public.material_request_items;
create policy "material_request_items: đọc" on public.material_request_items for select to authenticated
  using (exists (select 1 from public.material_requests r where r.id = material_request_items.request_id
    and ((select private.can_view_material(r.project_id)) or r.requester_id = (select auth.uid()))));
drop policy if exists "material_quotes: đọc" on public.material_quotes;
create policy "material_quotes: đọc" on public.material_quotes for select to authenticated
  using (exists (select 1 from public.material_requests r where r.id = material_quotes.request_id
    and ((select private.can_see_budget(r.project_id))
      or (r.project_id is null and ((select private.can_quote(null)) or r.requester_id = (select auth.uid()) or (select private.has_access('purchases.view')))))));

create or replace function public.material_request_save(p_id uuid, p_project uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  rid uuid := p_id;
  pid uuid := p_project;
begin
  if rid is not null then
    select * into r from public.material_requests where id = rid for update;
    if not found then raise exception 'MR_NOT_FOUND'; end if;
    if r.status not in ('draft', 'rejected') then raise exception 'MR_BAD_STATUS'; end if;
    pid := r.project_id;
    if not (r.requester_id = auth.uid() or (pid is not null and (select private.is_project_lead(pid))) or (select private.in_department('material')) or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  elsif auth.uid() is null then raise exception 'FORBIDDEN';
  elsif pid is not null and not ((select private.can_view_project(pid)) or (select private.in_department('material'))) then raise exception 'FORBIDDEN';
  end if;
  if rid is null then
    insert into public.material_requests (project_id, number, requester_name)
    values (pid,
      case when pid is null
        then 'YCVT-VP-' || lpad(((select count(*) from public.material_requests where project_id is null) + 1)::text, 3, '0')
        else 'YCVT-' || (select code from public.projects where id = pid) || '-' || lpad(((select count(*) from public.material_requests where project_id = pid) + 1)::text, 3, '0') end,
      coalesce((select full_name from public.profiles where id = auth.uid()), ''))
    returning id into rid;
  end if;
  update public.material_requests set requested_on = coalesce(nullif(p_data ->> 'requestedOn', '')::date, requested_on), note = btrim(coalesce(p_data ->> 'note', '')) where id = rid;
  delete from public.material_request_items where request_id = rid;
  insert into public.material_request_items (id, request_id, sort, name, spec, maker, unit, quantity, needed_on, note, budget_code)
  select coalesce(nullif(i ->> 'id', '')::uuid, gen_random_uuid()), rid, (ord - 1)::smallint, btrim(i ->> 'name'), btrim(coalesce(i ->> 'spec', '')), btrim(coalesce(i ->> 'maker', '')),
    btrim(coalesce(i ->> 'unit', '')), (i ->> 'quantity')::numeric, nullif(i ->> 'neededOn', '')::date, btrim(coalesce(i ->> 'note', '')),
    case when pid is null then null else nullif(i ->> 'budgetCode', '') end
  from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) with ordinality as t(i, ord);
  return rid;
end;
$$;

-- Chọn báo giá → đơn nháp: dự án tách mỗi mã ngân sách một đơn; văn phòng (không hạng mục) gộp một đơn
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
  new_order uuid;
  ids uuid[] := '{}';
  needed date;
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
    needed := code_row.needed;
    insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, supplier, supplier_contact, note, status, material_request_id)
    values ('tam', case when office then 'office' else 'project' end, r.project_id, code_row.code,
      left(r.number || ' · ' || case when code_row.n = 1 then code_row.first_name else code_row.first_name || ' và ' || (code_row.n - 1) || ' mục khác' end, 200),
      needed, addr, q.supplier, q.supplier_contact,
      btrim(concat_ws(' · ', 'Theo phiếu ' || r.number, nullif('báo giá ' || q.quote_ref, 'báo giá '), nullif('ĐK thanh toán: ' || q.payment_terms, 'ĐK thanh toán: '))),
      'draft', p_request)
    returning id into new_order;
    insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
    select new_order, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, (q.prices ->> i.id::text)::numeric
    from public.material_request_items i
    where i.request_id = p_request and (office or i.budget_code is not distinct from code_row.code) and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0;
    update public.purchase_orders set total_estimate = (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = new_order) where id = new_order;
    perform private.purchase_log(new_order, 'create', 'Lập từ ' || r.number || ' · ' || q.supplier);
    ids := ids || new_order;
  end loop;
  update public.material_quotes set selected = true where id = p_quote;
  update public.material_requests set status = 'ordered' where id = p_request;
  return ids;
end;
$$;

-- Thông báo / link của YCVT văn phòng mở trang Văn phòng
create or replace function private.step_doc_link(p_type text, p_doc uuid, p_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'purchase' then '/dat-hang/' || p_doc::text
    when 'payment' then '/dat-hang/' || coalesce((select pp.order_id::text from public.purchase_payments pp where pp.id = p_doc), '')
    when 'material' then case when p_project is null then '/dat-hang?muc=yeu-cau-vat-tu' else '/du-an/' || p_project::text || '?muc=yeu-cau-vat-tu' end
    else case when p_project is null then '' else '/du-an/' || p_project::text || '?muc=' || case p_type
      when 'contract' then 'hop-dong' when 'explanatory' then 'bao-cao-giai-thich' else 'ngan-sach' end end
  end;
$$;

-- YCVT văn phòng dùng cây duyệt mặc định của công ty (như dự án chưa cài cây riêng)
do $do$
declare d text;
begin
  d := pg_get_functiondef('private.create_steps(text,uuid,uuid)'::regprocedure);
  d := replace(d, 'if p_project is not null and tree is not null and jsonb_array_length(tree) > 0 then',
    'if (p_project is not null or p_type = ''material'') and tree is not null and jsonb_array_length(tree) > 0 then');
  if position('p_type = ''material'') and tree' in d) = 0 then raise exception 'create_steps: condition not found'; end if;
  execute d;
end
$do$;
