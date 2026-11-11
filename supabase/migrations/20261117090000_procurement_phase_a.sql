-- Mua hàng dự án theo quy trình công ty, giai đoạn A (docs/dac-ta-mua-hang-du-an.md):
--  * cost_codes: danh mục mã chi phí theo mẫu P-COST-03 (#100 thiết bị, #200 lắp đặt, #300 thầu phụ, #400 chi phí chung).
--  * procurement_settings: người thuộc từng bộ phận (Lãnh đạo, P. Kỹ thuật, P. Vật tư, Kế toán, Hành chánh).
--  * project_budget_sheets / lines: ngân sách dự án theo mã, có các lần lập (S…-01, -02), ký Phụ trách → Kỹ thuật → Lãnh đạo.
--  * approval_steps: chuỗi ký dùng chung cho ngân sách và đơn đặt hàng nháp (P-CC-07), có ngày mục tiêu.
--  * Đơn hàng dự án: bắt buộc mã ngân sách; khi gửi tính A (ngân sách mã), B (đã đặt), C (lần này), E = A − (B + C);
--    E < 0 thì chặn (PRC-03). Đơn đi chuỗi ký 6 bước; Lãnh đạo ký là đơn được duyệt. Đơn văn phòng giữ luồng cũ.

-- ───────────────────────── Mã chi phí ─────────────────────────
create table public.cost_codes (
  code text primary key check (code ~ '^[1-4][0-9]{2}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  active boolean not null default true
);
comment on table public.cost_codes is 'Mã chi phí theo mẫu P-COST-03; nhóm = chữ số đầu × 100.';
insert into public.cost_codes (code, name)
select split_part(entry, ' ', 1), substr(entry, position(' ' in entry) + 1)
from unnest(string_to_array(
  '111 BOILER, FLUE & TANK|112 HEAT EXCHANGER|113 KITCHEN EQUIPMENT|121 CHILLER|123 AIR COMPRESSOR & DRYER|132 COOLING TOWER|141 PUMP|151 HEATER|161 FAN|163 AIR FILTER|164 FAN COIL UNIT|165 AIR HANDLING UNIT|166 PACKAGED UNIT/HUMIDIFIER - DEHUMIDIFIER|167 DUCT, DUCT ACCESSORIES|168 GRILLES|169 VAV - CAV - SILENCER|171 MECHANICAL PIPING MATERIALS|172 ELECTRICAL PIPING|173 MV PANEL/ MV EQUIPMENT|174 TRANSFORMERS|175 SWITCH BOARD/PANEL|176 CABLE LADDER/ TRUNKING|177 CABLE|178 LIGHTING & SOCKET OUTLET|179 GENERATOR/UPS/BATTERY|181 ELV EQUIPMENT|182 AUTOMATIC CONTROL EQUIP./PANEL|183 AUTOMATIC FIELD DEVICES|184 LIGHTNING EQUIPMENT|185 SOLAR MODULE|186 SOLAR INVERTER/ EQUIPMENT|192 FIRE PROTECTION M-EQUIPMENT|193 FIRE PROTECTION E-EQUIPMENT|194 SANITARY EQUIPMENT|195 MISCELLANEOUS MATERIAL|196 CLEAN ROOM EQUIPMENT'
  || '|211 PIPING INSTALLATION|221 DUCTING INSTALLATION|231 ELECTRICAL WORK WITHOUT MATERIAL|241 BUILDING INSTALLATION|251 HOISTING & ASSEMBLY|252 BOOM LIFT/SCISSOR LIFT'
  || '|311 DUCT WORK|321 INSULATION|331 PAINTING WORK|341 ELECTRICAL WORK WITH MATERIAL|342 CONTROL WIRING|351 PIPING WORK WITH MATERIAL|352 BUILDING WORK|353 CR PANEL|354 WATER TREATMENT|355 FIRE FIGHTING WORK|361 MISC. WORK W/MATERIAL|362 MAINTENANCE, T&C WORK|363 A/C WORK|364 SANITARY WORK|399 NOT YET DECIDE AMOUNT'
  || '|411 TEMPORARY FACILITY|415 ELECTRICAL & WATER FEE|416 TRANSPORTATION|417 RENTAL FEE|418 IMPORTATION FEE|421 CONSULTANT FEE|454 FEE FOR SITE OFFICE|455 INSURANCE|478 SAFETY EQUIPMENT FEE|479 OFFICE MANAGEMENT|480 STATIONERY, TELEPHONE, INTERNET FEE|483 ENTERTAINMENT FEE|490 MISC EXPENSES',
  '|')) as entry;
alter table public.cost_codes enable row level security;
create policy "cost_codes: đọc" on public.cost_codes for select to authenticated using (true);
create policy "cost_codes: admin sửa" on public.cost_codes for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- ───────────────────────── Bộ phận ─────────────────────────
create table public.procurement_settings (
  id smallint primary key default 1 check (id = 1),
  departments jsonb not null default '{}'::jsonb check (jsonb_typeof(departments) = 'object'),
  updated_at timestamptz not null default now()
);
comment on table public.procurement_settings is 'Người (mã hồ sơ nhân sự) thuộc từng bộ phận ký duyệt: leader, technical, material, accounting, admin_office.';
insert into public.procurement_settings (id, departments) values (1, jsonb_build_object(
  'leader', to_jsonb(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}'::text[])),
  'technical', '[]'::jsonb, 'material', '[]'::jsonb, 'accounting', '[]'::jsonb, 'admin_office', '[]'::jsonb
)) on conflict (id) do nothing;
alter table public.procurement_settings enable row level security;
create policy "procurement_settings: đọc" on public.procurement_settings for select to authenticated using (true);
create policy "procurement_settings: admin sửa" on public.procurement_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function private.in_department(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.my_employee_id()) is not null
      and coalesce((select departments -> p_role from public.procurement_settings where id = 1), '[]'::jsonb) ? (select private.my_employee_id()), false)
    or (p_role = 'leader' and (select private.is_purchase_approver()));
$$;

create or replace function private.in_any_department()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.in_department('leader')) or (select private.in_department('technical')) or (select private.in_department('material'))
    or (select private.in_department('accounting')) or (select private.in_department('admin_office'));
$$;

-- Xem ngân sách theo mã: người xem được tiền của dự án, người thuộc bộ phận ký duyệt, quyền xem đặt hàng.
create or replace function private.can_see_budget(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_see_money(pid)) or (select private.in_any_department()) or (select private.has_access('purchases.view'));
$$;

-- Lập / sửa ngân sách: PM, CHT của dự án, P. Kỹ thuật, quyền quản lý dự án.
create or replace function private.can_edit_budget(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_project_lead(pid)) or (select private.in_department('technical')) or (select private.can_manage_projects());
$$;

-- Giữ vai trò của một bước ký (Admin ký thay được mọi bước).
create or replace function private.holds_step_role(p_role text, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or (p_role = 'pic' and (select private.is_project_pm(p_project)))
    or (p_role <> 'pic' and (select private.in_department(p_role)));
$$;

revoke all on function private.in_department(text), private.in_any_department(), private.can_see_budget(uuid), private.can_edit_budget(uuid), private.holds_step_role(text, uuid) from public, anon;
grant execute on function private.in_department(text), private.in_any_department(), private.can_see_budget(uuid), private.can_edit_budget(uuid), private.holds_step_role(text, uuid) to authenticated;

-- ───────────────────────── Ngân sách theo mã ─────────────────────────
create table public.project_budget_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  revision smallint not null check (revision > 0),
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  confirmation text not null default 'tentative' check (confirmation in ('confirmed', 'tentative')),
  exchange_rate numeric(12, 2) not null default 25000 check (exchange_rate > 0),
  quote_no text not null default '',
  offer_price bigint not null default 0 check (offer_price >= 0),
  contract_value bigint not null default 0 check (contract_value >= 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  unique (project_id, revision)
);
create unique index project_budget_sheets_one_open on public.project_budget_sheets (project_id) where status in ('draft', 'submitted', 'rejected');
comment on table public.project_budget_sheets is 'Các lần lập ngân sách dự án theo mã (P-COST-03). Chỉ ghi qua hàm budget_sheet_*.';

create table public.project_budget_lines (
  sheet_id uuid not null references public.project_budget_sheets (id) on delete cascade,
  code text not null references public.cost_codes (code),
  nett bigint not null default 0 check (nett >= 0),
  budget bigint not null default 0 check (budget >= 0),
  supplier text not null default '',
  contingency bigint not null default 0 check (contingency >= 0),
  remark text not null default '',
  primary key (sheet_id, code)
);

alter table public.project_budget_sheets enable row level security;
alter table public.project_budget_lines enable row level security;
create policy "project_budget_sheets: đọc" on public.project_budget_sheets for select to authenticated using ((select private.can_see_budget(project_id)));
create policy "project_budget_lines: đọc" on public.project_budget_lines for select to authenticated
  using (exists (select 1 from public.project_budget_sheets s where s.id = sheet_id and (select private.can_see_budget(s.project_id))));

-- ───────────────────────── Chuỗi ký ─────────────────────────
create table public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('budget', 'purchase')),
  doc_id uuid not null,
  project_id uuid references public.projects (id) on delete cascade,
  seq smallint not null,
  role text not null check (role in ('pic', 'technical', 'material', 'accounting', 'leader', 'admin_office')),
  target_date date not null,
  result text not null default 'pending' check (result in ('pending', 'signed', 'returned', 'skipped')),
  signer_id uuid,
  signer_name text not null default '',
  note text not null default '',
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (doc_type, doc_id, seq)
);
create index approval_steps_pending_idx on public.approval_steps (result, role) where result = 'pending';
comment on table public.approval_steps is 'Chuỗi ký theo bộ phận cho ngân sách và đơn đặt hàng nháp. Chỉ ghi qua hàm.';
alter table public.approval_steps enable row level security;

-- ───────────────────────── Đơn hàng: mã ngân sách ─────────────────────────
alter table public.purchase_orders
  add column budget_code text references public.cost_codes (code),
  add column budget_sheet_id uuid references public.project_budget_sheets (id) on delete set null,
  add column budget_a bigint,
  add column budget_b bigint,
  add column uses_chain boolean not null default false;

-- Người thuộc bộ phận ký duyệt xem được đơn hàng (để ký)
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
      or (select private.is_purchase_approver())
      or (select private.has_access('purchases.view'))
      or (select private.is_purchase_payer())
      or (select private.in_any_department())
      or (o.project_id is not null and (select private.is_project_lead(o.project_id)))
    )
  );
$$;

create policy "approval_steps: đọc" on public.approval_steps for select to authenticated using (
  (doc_type = 'budget' and project_id is not null and (select private.can_see_budget(project_id)))
  or (doc_type = 'purchase' and (select private.can_view_purchase(doc_id)))
);

-- ───────────────────────── Hàm nghiệp vụ ─────────────────────────
create or replace function private.next_workday(d date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare nd date := d + 1;
begin
  while extract(dow from nd) = 0 or exists (select 1 from public.holidays h where h.day = nd) loop nd := nd + 1; end loop;
  return nd;
end;
$$;

-- Dựng chuỗi ký; bộ phận chưa có ai (trừ Phụ trách, Lãnh đạo có người duyệt cũ) thì bỏ qua.
create or replace function private.create_steps(p_type text, p_doc uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  roles text[] := case p_type when 'budget' then array['pic', 'technical', 'leader'] else array['pic', 'technical', 'material', 'accounting', 'leader', 'admin_office'] end;
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  target date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  i int;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;
  for i in 1 .. array_length(roles, 1) loop
    skipped := roles[i] <> 'pic' and jsonb_array_length(coalesce(deps -> roles[i], '[]'::jsonb)) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    if not skipped then target := private.next_workday(target); end if;
    insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
    values (p_type, p_doc, p_project, i, roles[i], target, case when skipped then 'skipped' else 'pending' end);
  end loop;
end;
$$;

-- Ngân sách đang dùng của mã: lần lập mới nhất đã duyệt. B = các đơn đã duyệt, chưa hủy (trừ đơn đang xét).
create or replace function public.purchase_budget_check(p_project uuid, p_code text, p_order uuid default null)
returns table (sheet_id uuid, sheet_number text, budget_a bigint, ordered_b bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with sheet as (
    select s.id, s.number from public.project_budget_sheets s
    where s.project_id = p_project and s.status = 'approved' order by s.revision desc limit 1
  )
  select sheet.id, sheet.number,
    coalesce((select l.budget from public.project_budget_lines l where l.sheet_id = sheet.id and l.code = p_code), 0),
    coalesce((select sum(o.total_estimate) from public.purchase_orders o
      where o.project_id = p_project and o.budget_code = p_code and o.status in ('approved', 'ordered', 'received', 'completed')
        and (p_order is null or o.id <> p_order)), 0)::bigint
  from sheet
  where (select private.can_view_project(p_project)) or (select private.in_any_department()) or (select private.can_see_budget(p_project));
$$;

-- Lập lần ngân sách mới (chép từ lần mới nhất). Mỗi dự án chỉ có một lần đang mở.
create or replace function public.budget_sheet_new(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev public.project_budget_sheets;
  rev smallint;
  sid uuid;
begin
  if not (select private.can_edit_budget(p_project)) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.project_budget_sheets where project_id = p_project and status in ('draft', 'submitted', 'rejected')) then raise exception 'BUDGET_OPEN_EXISTS'; end if;
  select * into prev from public.project_budget_sheets where project_id = p_project order by revision desc limit 1;
  rev := coalesce(prev.revision, 0) + 1;
  insert into public.project_budget_sheets (project_id, revision, number, confirmation, exchange_rate, quote_no, offer_price, contract_value, note)
  values (p_project, rev, (select code from public.projects where id = p_project) || '-' || lpad(rev::text, 2, '0'),
    coalesce(prev.confirmation, 'tentative'), coalesce(prev.exchange_rate, 25000), coalesce(prev.quote_no, ''), coalesce(prev.offer_price, 0), coalesce(prev.contract_value, 0), '')
  returning id into sid;
  if prev.id is not null then
    insert into public.project_budget_lines (sheet_id, code, nett, budget, supplier, contingency, remark)
    select sid, code, nett, budget, supplier, contingency, remark from public.project_budget_lines where sheet_id = prev.id;
  end if;
  return sid;
end;
$$;

create or replace function public.budget_sheet_save(p_sheet uuid, p_header jsonb, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.project_budget_sheets;
begin
  select * into s from public.project_budget_sheets where id = p_sheet for update;
  if not found then raise exception 'BUDGET_NOT_FOUND'; end if;
  if not (select private.can_edit_budget(s.project_id)) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('draft', 'rejected') then raise exception 'BUDGET_BAD_STATUS'; end if;
  update public.project_budget_sheets set
    confirmation = coalesce(p_header ->> 'confirmation', confirmation),
    exchange_rate = coalesce((p_header ->> 'exchangeRate')::numeric, exchange_rate),
    quote_no = coalesce(btrim(p_header ->> 'quoteNo'), quote_no),
    offer_price = coalesce((p_header ->> 'offerPrice')::bigint, offer_price),
    contract_value = coalesce((p_header ->> 'contractValue')::bigint, contract_value),
    note = coalesce(btrim(p_header ->> 'note'), note)
  where id = p_sheet;
  delete from public.project_budget_lines where sheet_id = p_sheet;
  insert into public.project_budget_lines (sheet_id, code, nett, budget, supplier, contingency, remark)
  select p_sheet, l ->> 'code', coalesce((l ->> 'nett')::bigint, 0), coalesce((l ->> 'budget')::bigint, 0), coalesce(btrim(l ->> 'supplier'), ''),
    coalesce((l ->> 'contingency')::bigint, 0), coalesce(btrim(l ->> 'remark'), '')
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
end;
$$;

create or replace function public.budget_sheet_submit(p_sheet uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.project_budget_sheets;
begin
  select * into s from public.project_budget_sheets where id = p_sheet for update;
  if not found then raise exception 'BUDGET_NOT_FOUND'; end if;
  if not (select private.can_edit_budget(s.project_id)) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('draft', 'rejected') then raise exception 'BUDGET_BAD_STATUS'; end if;
  if not exists (select 1 from public.project_budget_lines where sheet_id = p_sheet and budget > 0) then raise exception 'BUDGET_EMPTY'; end if;
  update public.project_budget_sheets set status = 'submitted', submitted_at = now() where id = p_sheet;
  perform private.create_steps('budget', p_sheet, s.project_id);
  perform private.log_event('budget.submit', 'project_budget_sheet', p_sheet::text, jsonb_build_object('number', s.number));
end;
$$;

create or replace function public.budget_sheet_delete(p_sheet uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.project_budget_sheets;
begin
  select * into s from public.project_budget_sheets where id = p_sheet for update;
  if not found then raise exception 'BUDGET_NOT_FOUND'; end if;
  if not (select private.can_edit_budget(s.project_id)) then raise exception 'FORBIDDEN'; end if;
  if s.status not in ('draft', 'rejected') then raise exception 'BUDGET_BAD_STATUS'; end if;
  delete from public.approval_steps where doc_type = 'budget' and doc_id = p_sheet;
  delete from public.project_budget_sheets where id = p_sheet;
end;
$$;

-- Duyệt ngân sách: lần trước thành "đã thay", 4 khoản ngân sách cũ của dự án được tính lại từ các nhóm mã.
create or replace function private.budget_sheet_approve(p_sheet uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.project_budget_sheets;
begin
  select * into s from public.project_budget_sheets where id = p_sheet for update;
  update public.project_budget_sheets set status = 'superseded' where project_id = s.project_id and status = 'approved' and id <> p_sheet;
  update public.project_budget_sheets set status = 'approved', approved_at = now() where id = p_sheet;
  insert into public.project_budgets (project_id, category, amount)
  select s.project_id, c.category, coalesce(sum(l.budget), 0)
  from (values ('1', 'material'), ('2', 'labor'), ('3', 'subcontract'), ('4', 'other')) as c(head, category)
  left join public.project_budget_lines l on l.sheet_id = p_sheet and left(l.code, 1) = c.head
  group by c.category
  on conflict (project_id, category) do update set amount = excluded.amount;
end;
$$;

-- Gửi đơn: đơn dự án bắt buộc mã ngân sách, tính A–E, chặn khi vượt; rồi dựng chuỗi ký 6 bước.
create or replace function public.purchase_submit(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  total bigint;
  chk record;
begin
  if o.requester_id <> auth.uid() then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('draft', 'rejected') then raise exception 'PO_BAD_STATUS'; end if;
  if not exists (select 1 from public.purchase_items where order_id = p_order) then raise exception 'PO_NO_ITEMS'; end if;
  total := (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = p_order);
  if o.kind = 'project' then
    if o.budget_code is null then raise exception 'PO_BUDGET_CODE_REQUIRED'; end if;
    select * into chk from public.purchase_budget_check(o.project_id, o.budget_code, p_order);
    if chk.sheet_id is null then raise exception 'PO_NO_BUDGET'; end if;
    if chk.budget_a - (chk.ordered_b + total) < 0 then raise exception 'PO_OVER_BUDGET'; end if;
    update public.purchase_orders set status = 'submitted', submitted_at = now(), decision_note = '', total_estimate = total,
      budget_sheet_id = chk.sheet_id, budget_a = chk.budget_a, budget_b = chk.ordered_b, uses_chain = true
      where id = p_order;
    perform private.create_steps('purchase', p_order, o.project_id);
  else
    update public.purchase_orders set status = 'submitted', submitted_at = now(), decision_note = '', total_estimate = total, uses_chain = false where id = p_order;
  end if;
  perform private.purchase_log(p_order, 'submit', '');
end;
$$;

-- Sếp duyệt một bước: chỉ cho đơn văn phòng (đơn dự án đi chuỗi ký).
create or replace function public.purchase_decide(p_order uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.uses_chain then raise exception 'PO_USE_CHAIN'; end if;
  if not (select private.is_purchase_approver()) then raise exception 'PO_NOT_APPROVER'; end if;
  if o.status <> 'submitted' then raise exception 'PO_BAD_STATUS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  update public.purchase_orders set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = case when p_approve then auth.uid() end, approved_at = case when p_approve then now() end, decision_note = btrim(coalesce(p_note, ''))
    where id = p_order;
  perform private.purchase_log(p_order, case when p_approve then 'approve' else 'reject' end, p_note);
end;
$$;

-- Ký hoặc trả về một bước. Lãnh đạo ký là phiếu được duyệt (đơn: kiểm tra lại ngân sách lúc duyệt).
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
  elsif not exists (select 1 from public.project_budget_sheets where id = st.doc_id and status = 'submitted') then
    raise exception 'BUDGET_BAD_STATUS';
  end if;

  update public.approval_steps set result = case when p_approve then 'signed' else 'returned' end, signer_id = auth.uid(), signer_name = who,
    note = btrim(coalesce(p_note, '')), acted_at = now() where id = p_step;

  if not p_approve then
    if st.doc_type = 'purchase' then
      update public.purchase_orders set status = 'rejected', decision_note = btrim(p_note) where id = st.doc_id;
      perform private.purchase_log(st.doc_id, 'reject', btrim(p_note));
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
  elsif st.role = 'leader' then
    perform private.budget_sheet_approve(st.doc_id);
    perform private.log_event('budget.approve', 'project_budget_sheet', st.doc_id::text, '{}'::jsonb);
  end if;
end;
$$;

-- Các bước của một phiếu kèm "tôi ký được bước này không".
create or replace function public.approval_steps_of(p_type text, p_doc uuid)
returns table (id uuid, seq smallint, role text, target_date date, result text, signer_name text, note text, acted_at timestamptz, can_sign boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with steps as (
    select s.* from public.approval_steps s
    where s.doc_type = p_type and s.doc_id = p_doc
      and ((p_type = 'budget' and (select private.can_see_budget(s.project_id))) or (p_type = 'purchase' and (select private.can_view_purchase(p_doc))))
  ),
  cur as (select st.id from steps st where st.result = 'pending' and not exists (select 1 from steps r where r.result = 'returned') order by st.seq limit 1)
  select s.id, s.seq, s.role, s.target_date, s.result, s.signer_name, s.note, s.acted_at,
    s.id = (select cur.id from cur) and (select private.holds_step_role(s.role, s.project_id))
  from steps s order by s.seq;
$$;

-- Việc chờ tôi ký: bước đang chờ của mọi phiếu mà tôi giữ vai trò.
create or replace function public.my_approvals()
returns table (step_id uuid, doc_type text, doc_id uuid, project_id uuid, project_code text, title text, amount bigint, role text, target_date date)
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
    case c.doc_type when 'purchase' then (select o.code || ' · ' || o.title from public.purchase_orders o where o.id = c.doc_id)
      else 'Ngân sách ' || (select b.number from public.project_budget_sheets b where b.id = c.doc_id) end,
    case c.doc_type when 'purchase' then (select o.total_estimate from public.purchase_orders o where o.id = c.doc_id)
      else (select coalesce(sum(l.budget), 0)::bigint from public.project_budget_lines l where l.sheet_id = c.doc_id) end,
    c.role, c.target_date
  from cur c left join public.projects p on p.id = c.project_id
  where (select private.holds_step_role(c.role, c.project_id))
  order by c.target_date, c.doc_type;
$$;

-- Tên người trong từng bộ phận (để hiện trên giao diện).
create or replace function public.procurement_departments()
returns table (department text, employee_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.key, e.id, coalesce(e.doc ->> 'name', e.code)
  from public.procurement_settings s, jsonb_each(s.departments) d, jsonb_array_elements_text(d.value) m(id)
  join public.employees e on e.id = m.id
  where s.id = 1;
$$;

revoke all on function private.next_workday(date), private.create_steps(text, uuid, uuid), private.budget_sheet_approve(uuid) from public, anon, authenticated;
revoke all on function public.purchase_budget_check(uuid, text, uuid), public.budget_sheet_new(uuid), public.budget_sheet_save(uuid, jsonb, jsonb), public.budget_sheet_submit(uuid),
  public.budget_sheet_delete(uuid), public.approval_sign(uuid, boolean, text), public.approval_steps_of(text, uuid), public.my_approvals(), public.procurement_departments() from public, anon;
grant execute on function public.purchase_budget_check(uuid, text, uuid), public.budget_sheet_new(uuid), public.budget_sheet_save(uuid, jsonb, jsonb), public.budget_sheet_submit(uuid),
  public.budget_sheet_delete(uuid), public.approval_sign(uuid, boolean, text), public.approval_steps_of(text, uuid), public.my_approvals(), public.procurement_departments() to authenticated;
