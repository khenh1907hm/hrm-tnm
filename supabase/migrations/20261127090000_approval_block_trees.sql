-- Cây khối duyệt theo dự án (thay cho chia theo phòng ban), Lãnh đạo luôn là khối cuối.
--  * project_approval_trees(project_id, doc_type, blocks): doc_type 'contract' | 'budget' | 'purchase'
--    (ngân sách + báo cáo giải thích dùng cây 'budget'; đơn hàng, đề nghị thanh toán, yêu cầu vật tư dùng cây 'purchase').
--    blocks = [{"name": "Khối kỹ thuật", "mode": "any" | "sequence", "people": ["<mã hồ sơ>", …]}, …]; phần tử CUỐI là Lãnh đạo.
--  * Gửi phiếu: bước 1 là NGƯỜI GỬI, tự ký ngay (in tên vào ô ký khi xuất). Tiếp theo từng khối: "any" = một trong các người ký là đủ
--    (assignee_employee_id = 'any:id1,id2'), "sequence" = mỗi người một bước theo thứ tự. Khối giữa trống thì bỏ qua.
--    Vai trò của bước (để in đúng ô ký trên mẫu): người gửi = pic, khối cuối = leader, khối giữa lần lượt theo các ô còn lại của mẫu.
--  * Dự án chưa cài cây cho loại phiếu thì dùng quy trình chung cũ.
--  * Lãnh đạo ký xong (bước Lãnh đạo cuối) thì các bước còn chờ phía sau tự "bỏ qua" (hết thông báo treo, vd Kế toán sau khi đã duyệt).
--  * Tên người ký trống (tài khoản chưa có họ tên) thì lấy tên hồ sơ nhân sự hoặc email.

create table if not exists public.project_approval_trees (
  project_id uuid not null references public.projects (id) on delete cascade,
  doc_type text not null check (doc_type in ('contract', 'budget', 'purchase')),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (project_id, doc_type)
);
comment on table public.project_approval_trees is 'Cây khối duyệt của dự án theo loại phiếu; phần tử cuối là Lãnh đạo.';
alter table public.project_approval_trees enable row level security;
drop policy if exists "project_approval_trees: đọc" on public.project_approval_trees;
create policy "project_approval_trees: đọc" on public.project_approval_trees for select to authenticated using ((select private.can_view_project(project_id)));

create or replace function private.tree_doc_type(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'contract' then 'contract' when 'budget' then 'budget' when 'explanatory' then 'budget' else 'purchase' end;
$$;

-- Người có tên trong cây khối của dự án: xem được dự án để ký
create or replace function private.is_project_approver(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pid is not null and (select private.my_employee_id()) is not null and (
    exists (select 1 from public.project_approvers a where a.project_id = pid and a.employee_id = (select private.my_employee_id()))
    or exists (select 1 from public.project_approval_trees t, jsonb_array_elements(t.blocks) b, jsonb_array_elements_text(coalesce(b -> 'people', '[]'::jsonb)) p(id)
               where t.project_id = pid and p.id = (select private.my_employee_id())));
$$;

create or replace function public.project_approval_trees_of(p_project uuid)
returns table (doc_type text, blocks jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select t.doc_type, t.blocks from public.project_approval_trees t
  where t.project_id = p_project and (select private.can_view_project(p_project));
$$;

-- Danh sách người của khối: bỏ trùng, giữ thứ tự xuất hiện
create or replace function private.ordered_people(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select x, min(o) as o from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) with ordinality q(x, o) where x <> '' group by x
  ) d;
$$;

-- Chỉ Admin, Giám đốc cài cây. Mảng rỗng = xóa cây (dùng quy trình chung).
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
  if p_doc_type not in ('contract', 'budget', 'purchase') or jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then raise exception 'BAD_INPUT'; end if;
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

-- Người của bước: 'any:id1,id2' = một trong các người; mã đơn = đúng người đó.
create or replace function private.holds_step_strict(p_role text, p_project uuid, p_assignee text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.my_employee_id()) is null then false
    when p_assignee like 'any:%' then (select private.my_employee_id()) = any (string_to_array(substr(p_assignee, 5), ','))
    when p_assignee is not null then p_assignee = (select private.my_employee_id())
    when p_role = 'pic' then
      exists (select 1 from public.projects p where p.id = p_project and p.pm_employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.role = 'pm' and m.employee_id = (select private.my_employee_id()))
      or exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = 'pic' and a.employee_id = (select private.my_employee_id()))
    when (select private.project_role_assigned(p_role, p_project)) then
      exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = p_role and a.employee_id = (select private.my_employee_id()))
    else (select private.in_department(p_role))
  end;
$$;

create or replace function private.step_holder_users(p_role text, p_project uuid, p_assignee text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emps text[];
begin
  if p_assignee like 'any:%' then
    emps := string_to_array(substr(p_assignee, 5), ',');
  elsif p_assignee is not null then
    emps := array[p_assignee];
  elsif p_role = 'pic' then
    emps := array(select p.pm_employee_id from public.projects p where p.id = p_project and p.pm_employee_id is not null
      union select m.employee_id from public.project_members m where m.project_id = p_project and m.role = 'pm' and (m.left_on is null or m.left_on >= current_date)
      union select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = 'pic');
  elsif (select private.project_role_assigned(p_role, p_project)) then
    emps := array(select a.employee_id from public.project_approvers a where a.project_id = p_project and a.role = p_role);
  else
    emps := array(select jsonb_array_elements_text(coalesce((select departments -> p_role from public.procurement_settings where id = 1), '[]'::jsonb)));
    if p_role = 'leader' then
      emps := emps || coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}');
    end if;
  end if;
  return query
    select distinct pr.id from public.profiles pr
    where (pr.employee_id = any (coalesce(emps, '{}')) and pr.role <> 'pending')
       or (p_role = 'leader' and pr.is_director)
       or (p_assignee is null and p_role = 'leader' and not (select private.project_role_assigned('leader', p_project)) and pr.role in ('hr', 'engineer', 'employee') and 'purchases.approve' = any (coalesce(pr.permissions, '{}')));
  if not found then
    return query select pr.id from public.profiles pr where pr.role = 'admin';
  end if;
end;
$$;
revoke all on function private.step_holder_users(text, uuid, text) from public, anon, authenticated;

-- Dựng chuỗi ký: có cây khối của dự án thì theo cây; không thì theo quy trình chung.
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
  tree jsonb := (select t.blocks from public.project_approval_trees t where t.project_id = p_project and t.doc_type = private.tree_doc_type(p_type));
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

-- Tên người ký trống: lấy họ tên tài khoản, tên hồ sơ nhân sự hoặc email.
create or replace function private.approval_signer_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signer_id is not null and coalesce(new.signer_name, '') = '' then
    new.signer_name := coalesce(nullif((select full_name from public.profiles where id = new.signer_id), ''),
      (select coalesce(e.doc ->> 'name', e.code) from public.profiles pr join public.employees e on e.id = pr.employee_id where pr.id = new.signer_id),
      (select email from auth.users where id = new.signer_id), '');
  end if;
  return new;
end;
$$;
drop trigger if exists approval_signer_name on public.approval_steps;
create trigger approval_signer_name before insert or update on public.approval_steps
  for each row execute function private.approval_signer_name();

-- Lãnh đạo ký xong (không còn bước Lãnh đạo nào chờ): các bước chờ phía sau tự bỏ qua.
create or replace function private.approval_close_after_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'leader' and new.result = 'signed' and old.result is distinct from 'signed'
     and not exists (select 1 from public.approval_steps x where x.doc_type = new.doc_type and x.doc_id = new.doc_id and x.role = 'leader' and x.result = 'pending') then
    update public.approval_steps set result = 'skipped', note = 'Đã duyệt ở bước Lãnh đạo', acted_at = now()
    where doc_type = new.doc_type and doc_id = new.doc_id and result = 'pending' and seq > new.seq;
  end if;
  return null;
end;
$$;
drop trigger if exists approval_close_after_leader on public.approval_steps;
create trigger approval_close_after_leader after update of result on public.approval_steps
  for each row execute function private.approval_close_after_leader();

-- Dữ liệu cũ: phiếu đã được Lãnh đạo duyệt mà còn bước chờ phía sau (vd Kế toán, Hành chánh của Confirm Contract)
update public.approval_steps s set result = 'skipped', note = 'Đã duyệt ở bước Lãnh đạo', acted_at = now()
where s.result = 'pending' and exists (
  select 1 from public.approval_steps l where l.doc_type = s.doc_type and l.doc_id = s.doc_id and l.role = 'leader' and l.result = 'signed' and l.seq < s.seq)
  and not exists (select 1 from public.approval_steps l2 where l2.doc_type = s.doc_type and l2.doc_id = s.doc_id and l2.role = 'leader' and l2.result = 'pending');
-- Tên người ký trống của các bước đã ký
update public.approval_steps set signer_name = signer_name where signer_id is not null and signer_name = '';

revoke all on function public.project_approval_trees_of(uuid), public.project_approval_tree_save(uuid, text, jsonb) from public, anon;
grant execute on function public.project_approval_trees_of(uuid), public.project_approval_tree_save(uuid, text, jsonb) to authenticated;
