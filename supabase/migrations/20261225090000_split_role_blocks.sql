-- Chuỗi ký: khối "ký lần lượt" gộp nhiều chức danh (vd một khối "Lãnh đạo" chứa Kiểm soát đầu vào, Kỹ sư, Kế toán, Sếp)
-- trước đây làm mọi bước mang nhãn "Lãnh đạo". Tách khối đó thành từng khối theo chức danh (giữ thứ tự, giữ ký lần lượt);
-- chức danh cuối của khối cuối vẫn là Lãnh đạo.

create or replace function private.split_role_blocks(t jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when t is null or jsonb_typeof(t) <> 'array' then t else coalesce((
    select jsonb_agg(x.blk order by x.bo, x.po) from (
      select b.o as bo, 0::bigint as po, b.v as blk
      from jsonb_array_elements(t) with ordinality b(v, o)
      where not (coalesce(b.v ->> 'mode', 'any') = 'sequence'
        and (select count(*) from jsonb_array_elements_text(coalesce(b.v -> 'people', '[]'::jsonb)) q(x) where q.x like 'role:%') > 1)
      union all
      select b.o, p.o, jsonb_build_object(
        'name', case when b.o = jsonb_array_length(t) and p.o = jsonb_array_length(b.v -> 'people') then coalesce(nullif(btrim(b.v ->> 'name'), ''), 'Lãnh đạo')
          else coalesce(case p.x when 'role:leader' then 'Lãnh đạo' when 'role:technical' then 'Kỹ sư' when 'role:accounting' then 'Kế toán'
            when 'role:intake' then 'Kiểm soát đầu vào' when 'role:sales' then 'Kinh doanh' when 'role:warehouse' then 'Kho / Vật tư' when 'role:hr' then 'Nhân sự' end,
            nullif(btrim(b.v ->> 'name'), ''), 'Khối ' || b.o) end,
        'mode', 'sequence', 'people', jsonb_build_array(p.x))
      from jsonb_array_elements(t) with ordinality b(v, o)
      cross join lateral jsonb_array_elements_text(b.v -> 'people') with ordinality p(x, o)
      where coalesce(b.v ->> 'mode', 'any') = 'sequence'
        and (select count(*) from jsonb_array_elements_text(coalesce(b.v -> 'people', '[]'::jsonb)) q(x) where q.x like 'role:%') > 1
    ) x), t) end;
$$;

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
