-- Chia lại bộ phận ký duyệt (trang "Quy trình duyệt"):
--  * Thêm khối "Kho" (warehouse), tách khỏi P. Vật tư. Kho ký đầu tiên trên Yêu cầu vật tư (P-COST-08): Kho → P. Vật tư → P. Kỹ thuật → Lãnh đạo.
--  * Bỏ khối "Hành chánh" (admin_office): không còn bước Hành chánh trong đơn hàng và Confirm Contract.
--    Phát hành PO và ghi nhận NCC ký PO chuyển cho P. Vật tư (người của khối Vật tư công ty hoặc của dự án) và Admin.
--  * Bước Hành chánh cũ vẫn giữ trong lịch sử; bước còn chờ thì bỏ qua.

alter table public.approval_steps drop constraint if exists approval_steps_role_check;
alter table public.approval_steps add constraint approval_steps_role_check
  check (role in ('pic', 'technical', 'material', 'warehouse', 'accounting', 'leader', 'admin_office'));
delete from public.project_approvers where role = 'admin_office';
alter table public.project_approvers drop constraint if exists project_approvers_role_check;
alter table public.project_approvers add constraint project_approvers_role_check
  check (role in ('pic', 'technical', 'material', 'warehouse', 'accounting', 'leader'));

-- Cấu hình chung: bỏ Hành chánh, thêm Kho (trống)
update public.projects set approval_modes = approval_modes - 'admin_office' where approval_modes ? 'admin_office';
update public.procurement_settings
set departments = (departments - 'admin_office') || jsonb_build_object('warehouse', coalesce(departments -> 'warehouse', '[]'::jsonb)),
    modes = coalesce(modes, '{}'::jsonb) - 'admin_office',
    updated_at = now()
where id = 1;
comment on table public.procurement_settings is 'Người (mã hồ sơ nhân sự) thuộc từng bộ phận ký duyệt: leader, technical, material, warehouse, accounting.';

-- Bước Hành chánh còn chờ: bỏ qua (không gửi thông báo)
select set_config('app.skip_notify', '1', true);
update public.approval_steps set result = 'skipped', note = 'Bỏ khối Hành chánh', acted_at = now()
where role = 'admin_office' and result = 'pending';
select set_config('app.skip_notify', '', true);

create or replace function private.in_any_department()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.in_department('leader')) or (select private.in_department('technical')) or (select private.in_department('material'))
    or (select private.in_department('warehouse')) or (select private.in_department('accounting'));
$$;

create or replace function public.procurement_my_departments()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r), '{}') from unnest(array['leader', 'technical', 'material', 'warehouse', 'accounting']) r where (select private.in_department(r));
$$;

-- P. Vật tư phát hành PO chính thức cho đơn dự án đã được Lãnh đạo duyệt.
create or replace function public.purchase_issue_po(p_order uuid, p_supplier text, p_contact text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  po text;
begin
  if not (select private.is_admin()) and not (select private.holds_step_role('material', o.project_id)) then raise exception 'FORBIDDEN'; end if;
  if not o.uses_chain or o.status <> 'approved' or o.po_issued_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  if char_length(btrim(coalesce(p_supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  po := 'PO-' || (select code from public.projects where id = o.project_id) || '-'
    || lpad(((select count(*) from public.purchase_orders where project_id = o.project_id and po_no <> '') + 1)::text, 3, '0');
  update public.purchase_orders set po_no = po, po_issued_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')) where id = p_order;
  perform private.purchase_log(p_order, 'issue_po', po || ' · ' || btrim(p_supplier));
  return po;
end;
$$;

-- NCC đã ký bản sao PO gửi lại: PO có hiệu lực.
create or replace function public.purchase_supplier_accept(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.requester_id <> auth.uid() and not (select private.is_admin()) and not (select private.is_purchase_approver())
    and not (select private.holds_step_role('material', o.project_id))
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id))) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'approved' or o.po_issued_at is null or o.supplier_accepted_at is not null then raise exception 'PO_BAD_STATUS'; end if;
  update public.purchase_orders set supplier_accepted_at = now(), supplier_accept_note = btrim(coalesce(p_note, '')) where id = p_order;
  perform private.purchase_log(p_order, 'supplier_accept', btrim(coalesce(p_note, '')));
end;
$$;

create or replace function public.project_approvers_set(p_project uuid, p_items jsonb, p_modes jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.can_edit_approvers(p_project)) then raise exception 'FORBIDDEN'; end if;
  delete from public.project_approvers where project_id = p_project;
  insert into public.project_approvers (project_id, role, employee_id, position)
  select p_project, x ->> 'role', x ->> 'employeeId', min(o)::smallint
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality t(x, o)
  where x ->> 'role' in ('pic', 'technical', 'material', 'warehouse', 'accounting', 'leader') and coalesce(x ->> 'employeeId', '') <> ''
  group by x ->> 'role', x ->> 'employeeId';
  if p_modes is not null then
    update public.projects set approval_modes = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_modes) m(k, v) where v in ('any', 'sequence'))
    where id = p_project;
  end if;
  perform private.log_event('project.approvers', 'project', p_project::text, jsonb_build_object('items', coalesce(p_items, '[]'::jsonb), 'modes', p_modes));
end;
$$;

-- Chuỗi ký: Yêu cầu vật tư có thêm Kho; đơn hàng, Confirm Contract bỏ Hành chánh.

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
    when 'material' then array['warehouse', 'material', 'technical', 'leader']
    when 'contract' then array['pic', 'technical', 'material', 'leader', 'accounting']
    else array['pic', 'technical', 'material', 'accounting', 'leader'] end;
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    when 'explanatory' then array[1, 1, 1, 2, 2]
    when 'material' then array[1, 1, 1, 1]
    when 'contract' then array[1, 1, 1, 1, 1]
    else array[1, 1, 2, 3, 3] end;
  middle text[] := case p_type
    when 'budget' then array['technical']
    when 'payment' then array['technical', 'material']
    when 'explanatory' then array['technical', 'material', 'accounting']
    when 'material' then array['material', 'technical']
    else array['technical', 'material', 'accounting'] end;
  tree jsonb := private.project_tree_for(p_project, p_type);
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

  if p_project is not null and tree is not null and jsonb_array_length(tree) > 0 then
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
$$;

-- Thông báo: nhãn vai trò Kho
create or replace function private.approval_steps_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.approval_steps;
  label text := case new.doc_type
    when 'budget' then 'Ngân sách (P-COST-03)' when 'purchase' then 'Đơn đặt hàng (P-CC-07)' when 'payment' then 'Đề nghị thanh toán (P-CF-03)'
    when 'explanatory' then 'Báo cáo giải thích (P-COST-05)' when 'material' then 'Yêu cầu vật tư (P-COST-08)' when 'contract' then 'Xác nhận dự án (P-COST-01)' else new.doc_type end;
  role_label text;
  doc_title text;
  pcode text;
  link text;
  creator uuid;
begin
  if coalesce(current_setting('app.skip_notify', true), '') = '1' then return null; end if;
  doc_title := private.step_doc_title(new.doc_type, new.doc_id);
  pcode := coalesce((select p.code from public.projects p where p.id = new.project_id), '');
  link := private.step_doc_link(new.doc_type, new.doc_id, new.project_id);
  if tg_op = 'UPDATE' and new.result = 'returned' and old.result <> 'returned' then
    creator := private.step_doc_creator(new.doc_type, new.doc_id);
    if creator is not null then
      insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
      values (creator, 'approval_returned', new.id, new.doc_type, new.doc_id, new.project_id, 'Phiếu bị trả về: ' || label,
        concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), nullif(new.signer_name, ''), nullif(new.note, '')), link)
      on conflict do nothing;
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.result = 'signed' and old.result <> 'signed' and new.role = 'leader'
     and not exists (select 1 from public.approval_steps x where x.doc_type = new.doc_type and x.doc_id = new.doc_id and x.role = 'leader' and x.result = 'pending') then
    creator := private.step_doc_creator(new.doc_type, new.doc_id);
    if creator is not null and creator is distinct from new.signer_id then
      insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
      values (creator, 'approval_approved', new.id, new.doc_type, new.doc_id, new.project_id, 'Đã duyệt: ' || label,
        concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), nullif(new.signer_name, '')), link)
      on conflict do nothing;
    end if;
  end if;

  if exists (select 1 from public.approval_steps r where r.doc_type = new.doc_type and r.doc_id = new.doc_id and r.result = 'returned') then return null; end if;
  select * into cur from public.approval_steps s where s.doc_type = new.doc_type and s.doc_id = new.doc_id and s.result = 'pending' order by s.seq limit 1;
  if not found then return null; end if;
  role_label := case cur.role when 'pic' then 'Phụ trách' when 'technical' then 'P. Kỹ thuật' when 'material' then 'P. Vật tư' when 'warehouse' then 'Kho' when 'accounting' then 'Kế toán'
    when 'leader' then 'Lãnh đạo' when 'admin_office' then 'Hành chánh' else cur.role end;
  insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
  select u, 'approval_pending', cur.id, cur.doc_type, cur.doc_id, cur.project_id, 'Cần bạn duyệt: ' || label,
    concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), 'ký với vai trò ' || role_label, 'hạn ' || to_char(cur.target_date, 'DD/MM/YYYY')), link
  from private.step_holder_users(cur.role, cur.project_id, cur.assignee_employee_id) u
  where u is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
