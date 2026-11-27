-- YCVT theo đúng quy trình người dùng chốt (thay 20261228100000_material_direct_po):
-- 1) Lập phiếu → ký P. Vật tư → P. Kỹ thuật → Lãnh đạo (bỏ Kho khỏi chuỗi mặc định).
-- 2) Sếp duyệt xong P. Vật tư nhập nhiều báo giá; mỗi báo giá thuộc MỘT hạng mục (mã ngân sách).
-- 3) Chọn một báo giá = lập MỘT PO nháp (đủ NCC, đơn giá); mỗi báo giá ra một PO. Trên thanh của PO, YCVT là bước đầu.

-- (1) Chuỗi ký mặc định của YCVT: P. Vật tư → P. Kỹ thuật → Lãnh đạo (cây duyệt riêng của dự án vẫn ưu tiên như cũ)
create or replace function private.create_steps(p_type text, p_doc uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  roles text[] := case p_type
    when 'budget' then array['pic', 'technical', 'leader']
    when 'payment' then array['pic', 'technical', 'material', 'leader']
    when 'explanatory' then array['pic', 'technical', 'material', 'accounting', 'leader']
    when 'material' then array['material', 'technical', 'leader']
    when 'contract' then array['pic', 'technical', 'material', 'leader', 'accounting']
    else array['pic', 'technical', 'material', 'accounting', 'leader'] end;
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    when 'explanatory' then array[1, 1, 1, 2, 2]
    when 'material' then array[1, 1, 1]
    when 'contract' then array[1, 1, 1, 1, 1]
    else array[1, 1, 2, 3, 3] end;
  middle text[] := case p_type
    when 'budget' then array['technical']
    when 'payment' then array['technical', 'material']
    when 'explanatory' then array['technical', 'material', 'accounting']
    when 'material' then array['material', 'technical']
    else array['technical', 'material', 'accounting'] end;
  tree jsonb := private.split_role_blocks(private.project_tree_for(p_project, p_type));
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  modes jsonb := coalesce((select s.modes from public.procurement_settings s where id = 1), '{}'::jsonb);
  pmodes jsonb := coalesce((select p.approval_modes from public.projects p where p.id = p_project), '{}'::jsonb);
  start date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  who text := coalesce(nullif((select full_name from public.profiles where id = auth.uid()), ''),
    (select coalesce(e.doc ->> 'name', e.code) from public.profiles pr join public.employees e on e.id = pr.employee_id where pr.id = auth.uid()),
    (select email from auth.users where id = auth.uid()), '');
  target date;
  people text[];
  names text;
  mode text;
  emp text;
  blk jsonb;
  bname text;
  r text;
  last_block boolean;
  nb int;
  i int;
  k int;
  n int := 0;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;

  if (p_project is not null or p_type = 'material') and tree is not null and jsonb_array_length(tree) > 0 then
    -- Bước 1: người gửi, tự ký khi gửi
    n := 1;
    insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result, signer_id, signer_name, note, acted_at, assignee_name)
    values (p_type, p_doc, p_project, n, 'pic', start, 'signed', auth.uid(), who, 'Người gửi', now(), 'Người gửi');
    nb := jsonb_array_length(tree);
    for i in 0 .. nb - 1 loop
      blk := tree -> i;
      last_block := i = nb - 1;
      r := case when last_block then 'leader' else middle[least(i + 1, cardinality(middle))] end;
      people := private.ordered_people(blk -> 'people');
      mode := coalesce(blk ->> 'mode', 'any');
      bname := coalesce(nullif(btrim(blk ->> 'name'), ''), case when last_block then 'Lãnh đạo' else 'Khối ' || (i + 1) end);
      target := start;
      for k in 1 .. least(i + 1, 3) loop target := private.next_workday(target); end loop;
      if cardinality(people) = 0 and not last_block then continue; end if;
      if mode = 'sequence' and cardinality(people) > 1 then
        foreach emp in array people loop
          n := n + 1;
          insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result, assignee_employee_id, assignee_name)
          values (p_type, p_doc, p_project, n, r, target, 'pending', emp,
            bname || ' · ' || coalesce((select coalesce(e.doc ->> 'name', e.code) from public.employees e where e.id = emp), emp));
        end loop;
      else
        names := (select string_agg(coalesce(e.doc ->> 'name', e.code, x), ' / ' order by o) from unnest(people) with ordinality u(x, o) left join public.employees e on e.id = u.x);
        n := n + 1;
        insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result, assignee_employee_id, assignee_name)
        values (p_type, p_doc, p_project, n, r, target, 'pending', 'any:' || array_to_string(people, ','), bname || coalesce(': ' || names, ''));
      end if;
    end loop;
    return;
  end if;

  for i in 1 .. array_length(roles, 1) loop
    target := start;
    for k in 1 .. days[i] loop target := private.next_workday(target); end loop;
    if roles[i] = 'pic' then
      people := '{}'; mode := 'any';
    elsif (select private.project_role_assigned(roles[i], p_project)) then
      people := array(select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = roles[i] order by a.position, a.created_at);
      mode := coalesce(pmodes ->> roles[i], 'any');
    else
      people := array(select x from jsonb_array_elements_text(coalesce(deps -> roles[i], '[]'::jsonb)) with ordinality t(x, o) order by o);
      mode := coalesce(modes ->> roles[i], 'any');
    end if;
    skipped := roles[i] <> 'pic' and cardinality(people) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    if mode = 'sequence' and cardinality(people) > 1 then
      foreach emp in array people loop
        n := n + 1;
        insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result, assignee_employee_id, assignee_name)
        values (p_type, p_doc, p_project, n, roles[i], target, 'pending', emp,
          coalesce((select coalesce(e.doc ->> 'name', e.code) from public.employees e where e.id = emp), ''));
      end loop;
    else
      n := n + 1;
      insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
      values (p_type, p_doc, p_project, n, roles[i], target, case when skipped then 'skipped' else 'pending' end);
    end if;
  end loop;
end;
$function$;

-- (1b) Gửi phiếu lại đi ký (như trước 20261228100000): không tự lập PO nữa
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

-- (2) Báo giá gắn một hạng mục (mã ngân sách); văn phòng để trống
alter table public.material_quotes add column if not exists budget_code text;

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
  code text := nullif(btrim(coalesce(p_data ->> 'budgetCode', '')), '');
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
  if r.project_id is null then code := null; end if;
  if qid is null then insert into public.material_quotes (request_id, supplier) values (p_request, btrim(p_data ->> 'supplier')) returning id into qid; end if;
  update public.material_quotes set supplier = btrim(p_data ->> 'supplier'), supplier_contact = btrim(coalesce(p_data ->> 'supplierContact', '')),
    quote_ref = btrim(coalesce(p_data ->> 'quoteRef', '')), quote_date = nullif(p_data ->> 'quoteDate', '')::date,
    delivery_days = nullif(p_data ->> 'deliveryDays', '')::smallint, payment_terms = btrim(coalesce(p_data ->> 'paymentTerms', '')),
    note = btrim(coalesce(p_data ->> 'note', '')), prices = coalesce(p_data -> 'prices', '{}'::jsonb), budget_code = code
  where id = qid;
  return qid;
end;
$$;

-- (3) Chọn một báo giá → một PO nháp (các dòng có giá của hạng mục báo giá; NCC, đơn giá từ báo giá)
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
  code text;
  codes int;
  n int;
  first_name text;
  needed date;
  target uuid;
begin
  select * into r from public.material_requests where id = p_request for update;
  if not found then raise exception 'MR_NOT_FOUND'; end if;
  if r.status not in ('approved', 'ordered') then raise exception 'MR_NOT_APPROVED'; end if;
  if not (select private.can_quote(r.project_id)) then raise exception 'FORBIDDEN'; end if;
  office := r.project_id is null;
  select * into q from public.material_quotes where id = p_quote and request_id = p_request for update;
  if not found then raise exception 'MR_QUOTE_NOT_FOUND'; end if;
  if q.selected then raise exception 'MR_QUOTE_USED'; end if;
  code := case when office then null else q.budget_code end;

  -- Báo giá cũ chưa gắn hạng mục: lấy hạng mục của các dòng có giá, phải đúng một hạng mục
  if not office and code is null then
    select count(distinct i.budget_code), min(i.budget_code) into codes, code
    from public.material_request_items i
    where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0;
    if codes > 1 then raise exception 'MR_QUOTE_MULTI_GROUP'; end if;
  end if;

  select count(*), (array_agg(i.name order by i.sort))[1], min(i.needed_on) into n, first_name, needed
  from public.material_request_items i
  where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0
    and (office or q.budget_code is null or i.budget_code is not distinct from code);
  if n = 0 then raise exception 'MR_QUOTE_EMPTY'; end if;

  insert into public.purchase_orders (code, kind, project_id, budget_code, title, needed_by, delivery_address, supplier, supplier_contact, note, status, material_request_id)
  values ('tam', case when office then 'office' else 'project' end, r.project_id, code,
    left(r.number || ' · ' || case when n = 1 then first_name else first_name || ' và ' || (n - 1) || ' mục khác' end, 200),
    needed, case when office then '' else coalesce((select p.site from public.projects p where p.id = r.project_id), '') end,
    q.supplier, q.supplier_contact,
    btrim(concat_ws(' · ', 'Theo phiếu ' || r.number, nullif('báo giá ' || q.quote_ref, 'báo giá '), nullif('ĐK thanh toán: ' || q.payment_terms, 'ĐK thanh toán: '))),
    'draft', p_request)
  returning id into target;
  insert into public.purchase_items (order_id, sort, name, spec, unit, quantity, unit_price)
  select target, i.sort, i.name, btrim(concat_ws(' · ', nullif(i.spec, ''), nullif(i.maker, ''))), i.unit, i.quantity, (q.prices ->> i.id::text)::numeric
  from public.material_request_items i
  where i.request_id = p_request and coalesce((q.prices ->> i.id::text)::numeric, 0) > 0
    and (office or q.budget_code is null or i.budget_code is not distinct from code);
  update public.purchase_orders set total_estimate = (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = target) where id = target;
  perform private.purchase_log(target, 'create', 'Lập từ ' || r.number || ' · báo giá ' || q.supplier);
  update public.material_quotes set selected = true where id = p_quote;
  update public.material_requests set status = 'ordered' where id = p_request;
  return array[target];
end;
$$;
