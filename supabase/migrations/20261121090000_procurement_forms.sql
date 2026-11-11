-- Hoàn thiện quy trình mua hàng dự án theo biểu mẫu công ty (docs/dac-ta-mua-hang-du-an.md, chạy sau 20261120090000):
--  * P-COST-05 Báo cáo giải thích: explanatory_reports / lines. Ký Phụ trách → P. Kỹ thuật → P. Vật tư → Kế toán (HC-KT) → Lãnh đạo.
--    Lãnh đạo duyệt thì ngân sách đang dùng của mỗi mã có E = (B + C) − A > 0 được cộng thêm E (PRC-41), đơn vượt ngân sách gửi duyệt được.
--  * P-COST-08 Yêu cầu vật tư: material_requests / items. Ký Phòng Vật tư, Kho → P. Kỹ thuật → Lãnh đạo.
--    Hỏi giá: material_quotes (đơn giá theo từng dòng), bảng so sánh; chọn báo giá → đơn đặt hàng nháp P-CC-07, mỗi mã ngân sách một đơn.
--  * P-COST-01 Xác nhận dự án: project_contracts (các lần sửa). Ký Phụ trách → P. Kỹ thuật → VT-Kho → Lãnh đạo → Kế toán → Hành chánh.
--  Mọi ghi đều qua hàm (security definer); bảng chỉ có chính sách đọc.

-- ───────────────────────── Quyền ─────────────────────────
-- Xem phiếu yêu cầu vật tư (số lượng, không có giá): người xem được dự án, bộ phận ký duyệt, quyền xem đặt hàng.
create or replace function private.can_view_material(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_view_project(pid)) or (select private.in_any_department()) or (select private.has_access('purchases.view'));
$$;

-- Hỏi giá: P. Vật tư, P. Kỹ thuật, PM / CHT của dự án, Admin.
create or replace function private.can_quote(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.in_department('material')) or (select private.in_department('technical')) or (select private.is_project_lead(pid));
$$;

revoke all on function private.can_view_material(uuid), private.can_quote(uuid) from public, anon;
grant execute on function private.can_view_material(uuid), private.can_quote(uuid) to authenticated;

-- ───────────────────────── P-COST-05 ─────────────────────────
create table public.explanatory_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number text not null,
  kind text not null default 'budget_change' check (kind in ('budget_change', 'warranty', 'other')),
  warranty_done_on date,
  explanation text not null default '' check (char_length(explanation) <= 4000),
  attachments jsonb not null default '{}'::jsonb check (jsonb_typeof(attachments) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  order_id uuid references public.purchase_orders (id) on delete set null,
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  unique (project_id, number)
);
create table public.explanatory_report_lines (
  report_id uuid not null references public.explanatory_reports (id) on delete cascade,
  code text not null references public.cost_codes (code),
  budget_a bigint not null default 0 check (budget_a >= 0),
  ordered_b bigint not null default 0 check (ordered_b >= 0),
  needed_c bigint not null default 0 check (needed_c >= 0),
  primary key (report_id, code)
);
comment on table public.explanatory_reports is 'Báo cáo giải thích P-COST-05. Chỉ ghi qua hàm explanatory_*.';
alter table public.explanatory_reports enable row level security;
alter table public.explanatory_report_lines enable row level security;
create policy "explanatory_reports: đọc" on public.explanatory_reports for select to authenticated using ((select private.can_see_budget(project_id)));
create policy "explanatory_report_lines: đọc" on public.explanatory_report_lines for select to authenticated
  using (exists (select 1 from public.explanatory_reports r where r.id = report_id and (select private.can_see_budget(r.project_id))));

create or replace function public.explanatory_save(p_id uuid, p_project uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.explanatory_reports;
  rid uuid := p_id;
  pid uuid := p_project;
begin
  if rid is not null then
    select * into r from public.explanatory_reports where id = rid for update;
    if not found then raise exception 'EXP_NOT_FOUND'; end if;
    if r.status not in ('draft', 'rejected') then raise exception 'EXP_BAD_STATUS'; end if;
    pid := r.project_id;
  end if;
  if not ((select private.can_edit_budget(pid)) or (select private.is_project_pm(pid)) or (select private.in_department('material'))) then raise exception 'FORBIDDEN'; end if;
  if rid is null then
    insert into public.explanatory_reports (project_id, number, created_by_name)
    values (pid, 'GT-' || (select code from public.projects where id = pid) || '-' || lpad(((select count(*) from public.explanatory_reports where project_id = pid) + 1)::text, 2, '0'),
      coalesce((select full_name from public.profiles where id = auth.uid()), ''))
    returning id into rid;
  end if;
  update public.explanatory_reports set
    kind = coalesce(p_data ->> 'kind', 'budget_change'),
    warranty_done_on = nullif(p_data ->> 'warrantyDoneOn', '')::date,
    explanation = btrim(coalesce(p_data ->> 'explanation', '')),
    attachments = coalesce(p_data -> 'attachments', '{}'::jsonb),
    order_id = nullif(p_data ->> 'orderId', '')::uuid
  where id = rid;
  delete from public.explanatory_report_lines where report_id = rid;
  insert into public.explanatory_report_lines (report_id, code, budget_a, ordered_b, needed_c)
  select rid, l ->> 'code', coalesce((l ->> 'budgetA')::bigint, 0), coalesce((l ->> 'orderedB')::bigint, 0), coalesce((l ->> 'neededC')::bigint, 0)
  from jsonb_array_elements(coalesce(p_data -> 'lines', '[]'::jsonb)) l;
  return rid;
end;
$$;

create or replace function public.explanatory_submit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.explanatory_reports;
begin
  select * into r from public.explanatory_reports where id = p_id for update;
  if not found then raise exception 'EXP_NOT_FOUND'; end if;
  if r.status not in ('draft', 'rejected') then raise exception 'EXP_BAD_STATUS'; end if;
  if not ((select private.can_edit_budget(r.project_id)) or (select private.is_project_pm(r.project_id)) or (select private.in_department('material'))) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.explanatory_report_lines where report_id = p_id) then raise exception 'EXP_NO_LINES'; end if;
  if char_length(r.explanation) < 10 then raise exception 'EXP_EXPLANATION_REQUIRED'; end if;
  if r.kind = 'warranty' and r.warranty_done_on is null then raise exception 'EXP_WARRANTY_DATE_REQUIRED'; end if;
  if not exists (select 1 from public.project_budget_sheets where project_id = r.project_id and status = 'approved') then raise exception 'PO_NO_BUDGET'; end if;
  update public.explanatory_reports set status = 'submitted', submitted_at = now() where id = p_id;
  perform private.create_steps('explanatory', p_id, r.project_id);
end;
$$;

create or replace function public.explanatory_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.explanatory_reports;
begin
  select * into r from public.explanatory_reports where id = p_id for update;
  if not found then raise exception 'EXP_NOT_FOUND'; end if;
  if r.status not in ('draft', 'rejected') then raise exception 'EXP_BAD_STATUS'; end if;
  if not ((select private.can_edit_budget(r.project_id)) or r.created_by = auth.uid()) then raise exception 'FORBIDDEN'; end if;
  delete from public.approval_steps where doc_type = 'explanatory' and doc_id = p_id;
  delete from public.explanatory_reports where id = p_id;
end;
$$;

-- PRC-41: cộng E vào mã của ngân sách đang dùng và tính lại 4 khoản ngân sách cũ.
create or replace function private.explanatory_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.explanatory_reports;
  sid uuid;
begin
  select * into r from public.explanatory_reports where id = p_id for update;
  select id into sid from public.project_budget_sheets where project_id = r.project_id and status = 'approved' order by revision desc limit 1;
  if sid is null then raise exception 'PO_NO_BUDGET'; end if;
  insert into public.project_budget_lines (sheet_id, code, budget, remark)
  select sid, l.code, l.ordered_b + l.needed_c - l.budget_a, 'Tăng theo ' || r.number
  from public.explanatory_report_lines l where l.report_id = p_id and l.ordered_b + l.needed_c - l.budget_a > 0
  on conflict (sheet_id, code) do update set budget = public.project_budget_lines.budget + excluded.budget,
    remark = btrim(public.project_budget_lines.remark || ' ' || excluded.remark);
  insert into public.project_budgets (project_id, category, amount)
  select r.project_id, c.category, coalesce(sum(l.budget), 0)
  from (values ('1', 'material'), ('2', 'labor'), ('3', 'subcontract'), ('4', 'other')) as c(head, category)
  left join public.project_budget_lines l on l.sheet_id = sid and left(l.code, 1) = c.head
  group by c.category
  on conflict (project_id, category) do update set amount = excluded.amount;
  update public.explanatory_reports set status = 'approved', approved_at = now() where id = p_id;
end;
$$;
revoke all on function private.explanatory_approve(uuid) from public, anon, authenticated;

-- ───────────────────────── P-COST-08 + hỏi giá ─────────────────────────
create table public.material_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number text not null,
  requester_id uuid default auth.uid(),
  requester_name text not null default '',
  requested_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'closed')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  unique (project_id, number)
);
create table public.material_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests (id) on delete cascade,
  sort smallint not null default 0,
  name text not null check (char_length(btrim(name)) between 2 and 300),
  spec text not null default '',
  maker text not null default '',
  unit text not null default '',
  quantity numeric(14, 3) not null check (quantity > 0),
  needed_on date,
  note text not null default '',
  budget_code text references public.cost_codes (code)
);
create index material_request_items_req_idx on public.material_request_items (request_id);
create table public.material_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests (id) on delete cascade,
  supplier text not null check (char_length(btrim(supplier)) >= 2),
  supplier_contact text not null default '',
  quote_ref text not null default '',
  quote_date date,
  delivery_days smallint check (delivery_days is null or delivery_days >= 0),
  payment_terms text not null default '',
  note text not null default '',
  prices jsonb not null default '{}'::jsonb check (jsonb_typeof(prices) = 'object'),
  selected boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index material_quotes_req_idx on public.material_quotes (request_id);
alter table public.purchase_orders add column material_request_id uuid references public.material_requests (id) on delete set null;
comment on table public.material_requests is 'Phiếu yêu cầu vật tư P-COST-08. Chỉ ghi qua hàm material_*.';

alter table public.material_requests enable row level security;
alter table public.material_request_items enable row level security;
alter table public.material_quotes enable row level security;
create policy "material_requests: đọc" on public.material_requests for select to authenticated using ((select private.can_view_material(project_id)));
create policy "material_request_items: đọc" on public.material_request_items for select to authenticated
  using (exists (select 1 from public.material_requests r where r.id = request_id and (select private.can_view_material(r.project_id))));
-- Giá chỉ người xem được ngân sách mới thấy
create policy "material_quotes: đọc" on public.material_quotes for select to authenticated
  using (exists (select 1 from public.material_requests r where r.id = request_id and (select private.can_see_budget(r.project_id))));

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
    if not (r.requester_id = auth.uid() or (select private.is_project_lead(pid)) or (select private.in_department('material')) or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  elsif not ((select private.can_view_project(pid)) or (select private.in_department('material'))) then raise exception 'FORBIDDEN';
  end if;
  if rid is null then
    insert into public.material_requests (project_id, number, requester_name)
    values (pid, 'YCVT-' || (select code from public.projects where id = pid) || '-' || lpad(((select count(*) from public.material_requests where project_id = pid) + 1)::text, 3, '0'),
      coalesce((select full_name from public.profiles where id = auth.uid()), ''))
    returning id into rid;
  end if;
  update public.material_requests set requested_on = coalesce(nullif(p_data ->> 'requestedOn', '')::date, requested_on), note = btrim(coalesce(p_data ->> 'note', '')) where id = rid;
  delete from public.material_request_items where request_id = rid;
  insert into public.material_request_items (id, request_id, sort, name, spec, maker, unit, quantity, needed_on, note, budget_code)
  select coalesce(nullif(i ->> 'id', '')::uuid, gen_random_uuid()), rid, (ord - 1)::smallint, btrim(i ->> 'name'), btrim(coalesce(i ->> 'spec', '')), btrim(coalesce(i ->> 'maker', '')),
    btrim(coalesce(i ->> 'unit', '')), (i ->> 'quantity')::numeric, nullif(i ->> 'neededOn', '')::date, btrim(coalesce(i ->> 'note', '')), nullif(i ->> 'budgetCode', '')
  from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) with ordinality as t(i, ord);
  return rid;
end;
$$;

create or replace function public.material_request_submit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('draft', 'rejected') then raise exception 'MR_BAD_STATUS'; end if;
  if not (r.requester_id = auth.uid() or (select private.is_project_lead(r.project_id)) or (select private.in_department('material')) or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.material_request_items where request_id = p_id) then raise exception 'MR_NO_ITEMS'; end if;
  if exists (select 1 from public.material_request_items where request_id = p_id and btrim(unit) = '') then raise exception 'MR_UNIT_REQUIRED'; end if;
  update public.material_requests set status = 'submitted', submitted_at = now() where id = p_id;
  perform private.create_steps('material', p_id, r.project_id);
end;
$$;

create or replace function public.material_request_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status <> 'draft' then raise exception 'MR_BAD_STATUS'; end if;
  if not (r.requester_id = auth.uid() or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  delete from public.material_requests where id = p_id;
end;
$$;

create or replace function public.material_request_close(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('approved', 'ordered') then raise exception 'MR_BAD_STATUS'; end if;
  if not (select private.can_quote(r.project_id)) then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  update public.material_requests set status = 'closed', note = btrim(note || ' · Đóng: ' || btrim(p_note), ' ·') where id = p_id;
end;
$$;

-- Mã ngân sách từng dòng (P. Vật tư điền khi hỏi giá). p_codes: {"<id dòng>": "175" | null}
create or replace function public.material_request_codes(p_id uuid, p_codes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_id for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status in ('submitted', 'closed') then raise exception 'MR_BAD_STATUS'; end if;
  if not ((select private.can_quote(r.project_id)) or r.requester_id = auth.uid()) then raise exception 'FORBIDDEN'; end if;
  update public.material_request_items i set budget_code = nullif(p_codes ->> i.id::text, '')
  where i.request_id = p_id and p_codes ? i.id::text;
end;
$$;

create or replace function public.material_quote_save(p_id uuid, p_request uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  q public.material_quotes;
  qid uuid := p_id;
begin
  if qid is not null then
    select * into q from public.material_quotes where id = qid for update;
    if not found then raise exception 'MR_QUOTE_NOT_FOUND'; end if;
    if q.selected then raise exception 'MR_QUOTE_USED'; end if;
    p_request := q.request_id;
  end if;
  select * into r from public.material_requests where id = p_request;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('approved', 'ordered') then raise exception 'MR_NOT_APPROVED'; end if;
  if not (select private.can_quote(r.project_id)) then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_data ->> 'supplier', ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_data -> 'prices', '{}'::jsonb)) e where e.value::numeric < 0) then raise exception 'BUDGET_BAD_AMOUNT'; end if;
  if qid is null then insert into public.material_quotes (request_id, supplier) values (p_request, btrim(p_data ->> 'supplier')) returning id into qid; end if;
  update public.material_quotes set supplier = btrim(p_data ->> 'supplier'), supplier_contact = btrim(coalesce(p_data ->> 'supplierContact', '')),
    quote_ref = btrim(coalesce(p_data ->> 'quoteRef', '')), quote_date = nullif(p_data ->> 'quoteDate', '')::date,
    delivery_days = nullif(p_data ->> 'deliveryDays', '')::smallint, payment_terms = btrim(coalesce(p_data ->> 'paymentTerms', '')),
    note = btrim(coalesce(p_data ->> 'note', '')), prices = coalesce(p_data -> 'prices', '{}'::jsonb)
  where id = qid;
  return qid;
end;
$$;

create or replace function public.material_quote_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare q public.material_quotes;
begin
  select * into q from public.material_quotes where id = p_id for update;
  if not found then raise exception 'MR_QUOTE_NOT_FOUND'; end if;
  if q.selected then raise exception 'MR_QUOTE_USED'; end if;
  if not (select private.can_quote((select project_id from public.material_requests where id = q.request_id))) then raise exception 'FORBIDDEN'; end if;
  delete from public.material_quotes where id = p_id;
end;
$$;

-- PRC-53: báo giá được chọn → đơn đặt hàng nháp, mỗi mã ngân sách một đơn, người lập là người bấm.
create or replace function public.material_quote_to_orders(p_request uuid, p_quote uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.material_requests;
  q public.material_quotes;
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
  select * into q from public.material_quotes where id = p_quote and request_id = p_request for update;
  if not found then raise exception 'MR_QUOTE_NOT_FOUND'; end if;
  if q.selected then raise exception 'MR_QUOTE_USED'; end if;
  if not exists (select 1 from public.material_request_items i where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0) then raise exception 'MR_QUOTE_EMPTY'; end if;
  if exists (select 1 from public.material_request_items i where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0 and i.budget_code is null) then raise exception 'MR_ITEM_CODE_REQUIRED'; end if;
  select coalesce(p.site, '') into addr from public.projects p where p.id = r.project_id;
  for code_row in
    select i.budget_code, count(*) as n, min(i.name) filter (where i.sort = (select min(j.sort) from public.material_request_items j where j.request_id = p_request and j.budget_code = i.budget_code and coalesce((q.prices ->> j.id::text)::numeric, 0) > 0)) as first_name
    from public.material_request_items i
    where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0
    group by i.budget_code order by i.budget_code
  loop
    select min(i.needed_on) into needed from public.material_request_items i
    where i.request_id = p_request and i.budget_code = code_row.budget_code and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0;
    insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, supplier, supplier_contact, note, status, material_request_id)
    values ('tam', 'project', r.project_id, code_row.budget_code,
      left(r.number || ' · ' || case when code_row.n = 1 then code_row.first_name else code_row.first_name || ' và ' || (code_row.n - 1) || ' mục khác' end, 200),
      needed, addr, q.supplier, q.supplier_contact,
      btrim(concat_ws(' · ', 'Theo phiếu ' || r.number, nullif('báo giá ' || q.quote_ref, 'báo giá '), nullif('ĐK thanh toán: ' || q.payment_terms, 'ĐK thanh toán: '))),
      'draft', p_request)
    returning id into new_order;
    insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
    select new_order, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, (q.prices ->> i.id::text)::numeric
    from public.material_request_items i
    where i.request_id = p_request and i.budget_code = code_row.budget_code and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0;
    update public.purchase_orders set total_estimate = (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = new_order) where id = new_order;
    perform private.purchase_log(new_order, 'create', 'Lập từ ' || r.number || ' · ' || q.supplier);
    ids := ids || new_order;
  end loop;
  update public.material_quotes set selected = true where id = p_quote;
  update public.material_requests set status = 'ordered' where id = p_request;
  return ids;
end;
$$;

-- ───────────────────────── P-COST-01 ─────────────────────────
create table public.project_contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  revision smallint not null check (revision > 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  confirmation text not null default 'tentative' check (confirmation in ('confirmed', 'tentative')),
  issued_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  description text not null default '',
  quote_no text not null default '',
  quote_date date,
  quote_value bigint not null default 0 check (quote_value >= 0),
  confirmed_value bigint not null default 0 check (confirmed_value >= 0),
  customer_doc_no text not null default '',
  customer_doc_date date,
  payment_terms text not null default '',
  customer_name text not null default '',
  owner_name text not null default '',
  start_on date,
  end_on date,
  attachments jsonb not null default '{}'::jsonb check (jsonb_typeof(attachments) = 'object'),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  unique (project_id, revision)
);
create unique index project_contracts_one_open on public.project_contracts (project_id) where status in ('draft', 'submitted', 'rejected');
comment on table public.project_contracts is 'Xác nhận dự án P-COST-01 (mỗi lần sửa hợp đồng một dòng). Chỉ ghi qua hàm contract_*.';
alter table public.project_contracts enable row level security;
create policy "project_contracts: đọc" on public.project_contracts for select to authenticated using ((select private.can_see_budget(project_id)));

create or replace function public.contract_new(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev public.project_contracts;
  pr public.projects;
  cid uuid;
begin
  if not (select private.can_edit_budget(p_project)) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.project_contracts where project_id = p_project and status in ('draft', 'submitted', 'rejected')) then raise exception 'CONTRACT_OPEN_EXISTS'; end if;
  select * into prev from public.project_contracts where project_id = p_project order by revision desc limit 1;
  select * into pr from public.projects where id = p_project;
  if prev.id is null then
    insert into public.project_contracts (project_id, revision, description, start_on, end_on)
    values (p_project, 1, coalesce(pr.name, ''), pr.planned_start, pr.planned_end) returning id into cid;
  else
    insert into public.project_contracts (project_id, revision, confirmation, description, quote_no, quote_date, quote_value, confirmed_value, customer_doc_no, customer_doc_date,
      payment_terms, customer_name, owner_name, start_on, end_on, attachments, note)
    values (p_project, prev.revision + 1, prev.confirmation, prev.description, prev.quote_no, prev.quote_date, prev.quote_value, prev.confirmed_value, prev.customer_doc_no, prev.customer_doc_date,
      prev.payment_terms, prev.customer_name, prev.owner_name, prev.start_on, prev.end_on, prev.attachments, '') returning id into cid;
  end if;
  return cid;
end;
$$;

create or replace function public.contract_save(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.project_contracts;
begin
  select * into c from public.project_contracts where id = p_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if c.status not in ('draft', 'rejected') then raise exception 'CONTRACT_BAD_STATUS'; end if;
  if not (select private.can_edit_budget(c.project_id)) then raise exception 'FORBIDDEN'; end if;
  if nullif(p_data ->> 'startOn', '')::date > nullif(p_data ->> 'endOn', '')::date then raise exception 'CONTRACT_BAD_DATES'; end if;
  update public.project_contracts set
    confirmation = coalesce(p_data ->> 'confirmation', 'tentative'),
    issued_on = coalesce(nullif(p_data ->> 'issuedOn', '')::date, issued_on),
    description = btrim(coalesce(p_data ->> 'description', '')),
    quote_no = btrim(coalesce(p_data ->> 'quoteNo', '')),
    quote_date = nullif(p_data ->> 'quoteDate', '')::date,
    quote_value = coalesce((p_data ->> 'quoteValue')::bigint, 0),
    confirmed_value = coalesce((p_data ->> 'confirmedValue')::bigint, 0),
    customer_doc_no = btrim(coalesce(p_data ->> 'customerDocNo', '')),
    customer_doc_date = nullif(p_data ->> 'customerDocDate', '')::date,
    payment_terms = btrim(coalesce(p_data ->> 'paymentTerms', '')),
    customer_name = btrim(coalesce(p_data ->> 'customerName', '')),
    owner_name = btrim(coalesce(p_data ->> 'ownerName', '')),
    start_on = nullif(p_data ->> 'startOn', '')::date,
    end_on = nullif(p_data ->> 'endOn', '')::date,
    attachments = coalesce(p_data -> 'attachments', '{}'::jsonb),
    note = btrim(coalesce(p_data ->> 'note', ''))
  where id = p_id;
end;
$$;

create or replace function public.contract_submit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.project_contracts;
begin
  select * into c from public.project_contracts where id = p_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if c.status not in ('draft', 'rejected') then raise exception 'CONTRACT_BAD_STATUS'; end if;
  if not (select private.can_edit_budget(c.project_id)) then raise exception 'FORBIDDEN'; end if;
  if c.confirmed_value <= 0 then raise exception 'CONTRACT_VALUE_REQUIRED'; end if;
  if char_length(c.customer_name) < 2 then raise exception 'CONTRACT_CUSTOMER_REQUIRED'; end if;
  if c.confirmation = 'confirmed' and c.customer_doc_no = '' and not coalesce((c.attachments ->> 'signedQuoteOrPo')::boolean, false) then raise exception 'CONTRACT_CUSTOMER_DOC_REQUIRED'; end if;
  update public.project_contracts set status = 'submitted', submitted_at = now() where id = p_id;
  perform private.create_steps('contract', p_id, c.project_id);
end;
$$;

create or replace function public.contract_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.project_contracts;
begin
  select * into c from public.project_contracts where id = p_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if c.status not in ('draft', 'rejected') then raise exception 'CONTRACT_BAD_STATUS'; end if;
  if not (select private.can_edit_budget(c.project_id)) then raise exception 'FORBIDDEN'; end if;
  delete from public.approval_steps where doc_type = 'contract' and doc_id = p_id;
  delete from public.project_contracts where id = p_id;
end;
$$;

-- ───────────────────────── Chuỗi ký dùng chung ─────────────────────────
alter table public.approval_steps drop constraint approval_steps_doc_type_check;
alter table public.approval_steps add constraint approval_steps_doc_type_check check (doc_type in ('budget', 'purchase', 'payment', 'explanatory', 'material', 'contract'));

create or replace function private.can_view_step_doc(p_type text, p_doc uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'budget' then p_project is not null and (select private.can_see_budget(p_project))
    when 'purchase' then (select private.can_view_purchase(p_doc))
    when 'payment' then exists (select 1 from public.purchase_payments p where p.id = p_doc and (select private.can_view_purchase(p.order_id)))
    when 'explanatory' then p_project is not null and (select private.can_see_budget(p_project))
    when 'contract' then p_project is not null and (select private.can_see_budget(p_project))
    when 'material' then p_project is not null and (select private.can_view_material(p_project))
    else false end;
$$;
revoke all on function private.can_view_step_doc(text, uuid, uuid) from public, anon;
grant execute on function private.can_view_step_doc(text, uuid, uuid) to authenticated;

drop policy "approval_steps: đọc" on public.approval_steps;
create policy "approval_steps: đọc" on public.approval_steps for select to authenticated using ((select private.can_view_step_doc(doc_type, doc_id, project_id)));

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
    when 'explanatory' then array['pic', 'technical', 'material', 'accounting', 'leader']
    when 'material' then array['material', 'technical', 'leader']
    when 'contract' then array['pic', 'technical', 'material', 'leader', 'accounting', 'admin_office']
    else array['pic', 'technical', 'material', 'accounting', 'leader', 'admin_office'] end;
  -- Ngày làm việc thứ mấy kể từ ngày gửi, theo mẫu và sơ đồ tổng quan (yêu cầu vật tư 1 ngày, xác nhận dự án 1 ngày)
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    when 'explanatory' then array[1, 1, 1, 2, 2]
    when 'material' then array[1, 1, 1]
    when 'contract' then array[1, 1, 1, 1, 1, 1]
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

create or replace function public.approval_sign(p_step uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.approval_steps;
  cur uuid;
  o public.purchase_orders;
  pay public.purchase_payments;
  chk record;
  who text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
begin
  select * into st from public.approval_steps where id = p_step for update;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  if exists (select 1 from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'returned') then raise exception 'STEP_NOT_CURRENT'; end if;
  select id into cur from public.approval_steps where doc_type = st.doc_type and doc_id = st.doc_id and result = 'pending' order by seq limit 1;
  if cur is distinct from st.id then raise exception 'STEP_NOT_CURRENT'; end if;
  if not (select private.holds_step_role(st.role, st.project_id)) then raise exception 'STEP_NOT_YOURS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;

  if st.doc_type = 'purchase' then
    o := private.purchase_lock(st.doc_id);
    if o.status <> 'submitted' then raise exception 'PO_BAD_STATUS'; end if;
  elsif st.doc_type = 'payment' then
    select * into pay from public.purchase_payments where id = st.doc_id for update;
    if not found or pay.status <> 'requested' then raise exception 'PO_BAD_STATUS'; end if;
    perform private.purchase_lock(pay.order_id);
  elsif st.doc_type = 'explanatory' then
    if not exists (select 1 from public.explanatory_reports where id = st.doc_id and status = 'submitted') then raise exception 'EXP_BAD_STATUS'; end if;
  elsif st.doc_type = 'material' then
    if not exists (select 1 from public.material_requests where id = st.doc_id and status = 'submitted') then raise exception 'MR_BAD_STATUS'; end if;
  elsif st.doc_type = 'contract' then
    -- Kế toán, Hành chánh ký sau Lãnh đạo khi xác nhận đã được duyệt
    if not exists (select 1 from public.project_contracts where id = st.doc_id and status in ('submitted', 'approved')) then raise exception 'CONTRACT_BAD_STATUS'; end if;
  elsif not exists (select 1 from public.project_budget_sheets where id = st.doc_id and status = 'submitted') then
    raise exception 'BUDGET_BAD_STATUS';
  end if;

  update public.approval_steps set result = case when p_approve then 'signed' else 'returned' end, signer_id = auth.uid(), signer_name = who,
    note = btrim(coalesce(p_note, '')), acted_at = now() where id = p_step;

  if not p_approve then
    if st.doc_type = 'purchase' then
      update public.purchase_orders set status = 'rejected', decision_note = btrim(p_note) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'reject', btrim(p_note));
    elsif st.doc_type = 'payment' then
      update public.purchase_payments set status = 'rejected', decision_note = btrim(p_note) where id = st.doc_id;
      perform private.purchase_log(pay.order_id, 'payment_reject:' || pay.kind, pay.rfp_no || ' · ' || btrim(p_note));
    elsif st.doc_type = 'explanatory' then
      update public.explanatory_reports set status = 'rejected' where id = st.doc_id;
    elsif st.doc_type = 'material' then
      update public.material_requests set status = 'rejected' where id = st.doc_id;
    elsif st.doc_type = 'contract' then
      update public.project_contracts set status = 'rejected' where id = st.doc_id;
    else
      update public.project_budget_sheets set status = 'rejected' where id = st.doc_id;
    end if;
    return;
  end if;

  if st.doc_type = 'purchase' then
    perform private.purchase_log(st.doc_id, 'sign:' || st.role, btrim(coalesce(p_note, '')));
    if st.role = 'leader' then
      select * into chk from public.purchase_budget_check(o.project_id, o.budget_code, o.id);
      if chk.sheet_id is null or chk.budget_a - (chk.ordered_b + o.total_estimate) < 0 then raise exception 'PO_OVER_BUDGET'; end if;
      update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now(), budget_a = chk.budget_a, budget_b = chk.ordered_b,
        budget_sheet_id = chk.sheet_id, decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'approve', btrim(coalesce(p_note, '')));
    end if;
  elsif st.doc_type = 'payment' then
    if st.role = 'leader' then
      update public.purchase_payments set status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = btrim(coalesce(p_note, '')) where id = st.doc_id;
      perform private.purchase_log(pay.order_id, 'payment_approve:' || pay.kind, pay.rfp_no || ' · ' || pay.amount::text || ' đ');
    else
      perform private.purchase_log(pay.order_id, 'payment_sign:' || st.role, pay.rfp_no);
    end if;
  elsif st.doc_type = 'explanatory' then
    if st.role = 'leader' then
      perform private.explanatory_approve(st.doc_id);
      perform private.log_event('explanatory.approve', 'explanatory_report', st.doc_id::text, '{}'::jsonb);
    end if;
  elsif st.doc_type = 'material' then
    if st.role = 'leader' then update public.material_requests set status = 'approved', approved_at = now() where id = st.doc_id; end if;
  elsif st.doc_type = 'contract' then
    if st.role = 'leader' then
      update public.project_contracts set status = 'superseded' where project_id = st.project_id and status = 'approved' and id <> st.doc_id;
      update public.project_contracts set status = 'approved', approved_at = now() where id = st.doc_id;
      perform private.log_event('contract.approve', 'project_contract', st.doc_id::text, '{}'::jsonb);
    end if;
  elsif st.role = 'leader' then
    perform private.budget_sheet_approve(st.doc_id);
    perform private.log_event('budget.approve', 'project_budget_sheet', st.doc_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.approval_steps_of(p_type text, p_doc uuid)
returns table (id uuid, seq smallint, role text, target_date date, result text, signer_name text, note text, acted_at timestamptz, can_sign boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with steps as (
    select s.* from public.approval_steps s
    where s.doc_type = p_type and s.doc_id = p_doc and (select private.can_view_step_doc(s.doc_type, s.doc_id, s.project_id))
  ),
  cur as (select st.id from steps st where st.result = 'pending' and not exists (select 1 from steps r where r.result = 'returned') order by st.seq limit 1)
  select s.id, s.seq, s.role, s.target_date, s.result, s.signer_name, s.note, s.acted_at,
    s.id = (select cur.id from cur) and (select private.holds_step_role(s.role, s.project_id))
  from steps s order by s.seq;
$$;

create or replace function public.my_approvals()
returns table (step_id uuid, doc_type text, doc_id uuid, project_id uuid, project_code text, title text, amount bigint, role text, target_date date, order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (
    select distinct on (s.doc_type, s.doc_id) s.*
    from public.approval_steps s
    where s.result = 'pending'
      and not exists (select 1 from public.approval_steps r where r.doc_type = s.doc_type and r.doc_id = s.doc_id and r.result = 'returned')
    order by s.doc_type, s.doc_id, s.seq
  )
  select c.id, c.doc_type, c.doc_id, c.project_id, p.code,
    case c.doc_type
      when 'purchase' then (select o.code || ' · ' || o.title from public.purchase_orders o where o.id = c.doc_id)
      when 'payment' then (select pp.rfp_no || ' · ' || o.code || ' · ' || o.title from public.purchase_payments pp join public.purchase_orders o on o.id = pp.order_id where pp.id = c.doc_id)
      when 'explanatory' then (select r.number || ' · ' || left(r.explanation, 60) from public.explanatory_reports r where r.id = c.doc_id)
      when 'material' then (select m.number || ' · ' || (select count(*) from public.material_request_items i where i.request_id = m.id) || ' dòng vật tư' from public.material_requests m where m.id = c.doc_id)
      when 'contract' then (select 'Xác nhận dự án lần ' || k.revision from public.project_contracts k where k.id = c.doc_id)
      else 'Ngân sách ' || (select b.number from public.project_budget_sheets b where b.id = c.doc_id) end,
    case c.doc_type
      when 'purchase' then (select o.total_estimate from public.purchase_orders o where o.id = c.doc_id)
      when 'payment' then (select pp.amount + pp.vat_amount from public.purchase_payments pp where pp.id = c.doc_id)
      when 'explanatory' then (select greatest(coalesce(sum(l.ordered_b + l.needed_c - l.budget_a), 0), 0)::bigint from public.explanatory_report_lines l where l.report_id = c.doc_id)
      when 'material' then 0::bigint
      when 'contract' then (select k.confirmed_value from public.project_contracts k where k.id = c.doc_id)
      else (select coalesce(sum(l.budget), 0)::bigint from public.project_budget_lines l where l.sheet_id = c.doc_id) end,
    c.role, c.target_date,
    case c.doc_type when 'payment' then (select pp.order_id from public.purchase_payments pp where pp.id = c.doc_id) end
  from cur c left join public.projects p on p.id = c.project_id
  where (select private.holds_step_role(c.role, c.project_id))
  order by c.target_date, c.doc_type;
$$;

revoke all on function
  public.explanatory_save(uuid, uuid, jsonb), public.explanatory_submit(uuid), public.explanatory_delete(uuid),
  public.material_request_save(uuid, uuid, jsonb), public.material_request_submit(uuid), public.material_request_delete(uuid), public.material_request_close(uuid, text),
  public.material_request_codes(uuid, jsonb), public.material_quote_save(uuid, uuid, jsonb), public.material_quote_delete(uuid), public.material_quote_to_orders(uuid, uuid),
  public.contract_new(uuid), public.contract_save(uuid, jsonb), public.contract_submit(uuid), public.contract_delete(uuid)
from public, anon;
grant execute on function
  public.explanatory_save(uuid, uuid, jsonb), public.explanatory_submit(uuid), public.explanatory_delete(uuid),
  public.material_request_save(uuid, uuid, jsonb), public.material_request_submit(uuid), public.material_request_delete(uuid), public.material_request_close(uuid, text),
  public.material_request_codes(uuid, jsonb), public.material_quote_save(uuid, uuid, jsonb), public.material_quote_delete(uuid), public.material_quote_to_orders(uuid, uuid),
  public.contract_new(uuid), public.contract_save(uuid, jsonb), public.contract_submit(uuid), public.contract_delete(uuid)
to authenticated;
