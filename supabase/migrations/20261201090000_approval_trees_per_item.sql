-- Cây duyệt theo TỪNG MỤC của dự án (tab "Quy trình duyệt"):
--  * project_approval_trees.doc_type nhận thêm 'explanatory' (Báo cáo giải thích), 'material' (Yêu cầu vật tư), 'payment' (Yêu cầu thanh toán RFP).
--  * Gửi phiếu: dùng cây riêng của đúng mục; mục chưa cài riêng thì dùng cây nhóm cũ
--    (giải thích → ngân sách; vật tư, RFP → đặt hàng); chưa có nữa thì theo quy trình chung của công ty.

alter table public.project_approval_trees drop constraint if exists project_approval_trees_doc_type_check;
alter table public.project_approval_trees add constraint project_approval_trees_doc_type_check
  check (doc_type in ('contract', 'budget', 'explanatory', 'material', 'purchase', 'payment'));

create or replace function public.project_approval_tree_save(p_project uuid, p_doc_type text, p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean jsonb;
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if p_doc_type not in ('contract', 'budget', 'explanatory', 'material', 'purchase', 'payment') or jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then raise exception 'BAD_INPUT'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(btrim(coalesce(b ->> 'name', '')), 60),
      'mode', case when b ->> 'mode' = 'sequence' then 'sequence' else 'any' end,
      'people', to_jsonb(private.ordered_people(b -> 'people'))
    ) order by i), '[]'::jsonb)
  into clean
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality e(b, i);
  if jsonb_array_length(clean) = 0 then
    delete from public.project_approval_trees where project_id = p_project and doc_type = p_doc_type;
  else
    insert into public.project_approval_trees (project_id, doc_type, blocks, updated_at) values (p_project, p_doc_type, clean, now())
    on conflict (project_id, doc_type) do update set blocks = excluded.blocks, updated_at = now();
  end if;
  perform private.log_event('project.approval_tree', 'project', p_project::text, jsonb_build_object('docType', p_doc_type, 'blocks', clean));
end;
$$;

-- Cây dùng khi gửi phiếu: cây riêng của mục, không có thì cây nhóm
create or replace function private.project_tree_for(p_project uuid, p_type text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.blocks from public.project_approval_trees t where t.project_id = p_project and t.doc_type = p_type),
    (select t.blocks from public.project_approval_trees t where t.project_id = p_project and t.doc_type = private.tree_doc_type(p_type)));
$$;
revoke all on function private.project_tree_for(uuid, text) from public, anon, authenticated;

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
  days int[] := case p_type
    when 'budget' then array[1, 1, 2]
    when 'payment' then array[1, 1, 1, 2]
    when 'explanatory' then array[1, 1, 1, 2, 2]
    when 'material' then array[1, 1, 1]
    when 'contract' then array[1, 1, 1, 1, 1, 1]
    else array[1, 1, 2, 3, 3, 3] end;
  middle text[] := case p_type
    when 'budget' then array['technical']
    when 'payment' then array['technical', 'material']
    when 'explanatory' then array['technical', 'material', 'accounting']
    when 'material' then array['material', 'technical']
    else array['technical', 'material', 'accounting', 'admin_office'] end;
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
