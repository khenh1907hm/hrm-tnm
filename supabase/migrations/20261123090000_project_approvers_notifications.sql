-- Phân quyền duyệt theo dự án, Giám đốc duyệt vượt cấp, thông báo trong app + email.
--  * project_approvers: người duyệt riêng của từng dự án theo vai trò ký (Phụ trách, P. Kỹ thuật, P. Vật tư, Kế toán, Lãnh đạo, Hành chánh).
--    Vai trò nào dự án có đặt người thì CHỈ những người đó (cùng Admin, Giám đốc) ký bước đó; chưa đặt thì dùng bộ phận chung (procurement_settings).
--    Người duyệt của dự án xem được dự án và các phiếu của dự án để ký.
--  * profiles.is_director: Giám đốc ký được mọi bước và "Duyệt ngay" (bỏ qua các bước trước bước Lãnh đạo).
--  * profiles.notify_email / notify_enabled: email nhận thông báo do người dùng tự đặt.
--  * user_notifications: thông báo trong app (chuông), dựng tự động khi một bước ký đến lượt, khi phiếu bị trả về hoặc được duyệt.
--    Máy chủ (khóa bí mật) gửi email cho các dòng chưa gửi rồi ghi emailed_at.

-- ───────────────────────── Hồ sơ ─────────────────────────
alter table public.profiles add column if not exists is_director boolean not null default false;
alter table public.profiles add column if not exists notify_email text not null default '';
alter table public.profiles add column if not exists notify_enabled boolean not null default true;
comment on column public.profiles.is_director is 'Giám đốc: ký thay mọi bước và duyệt ngay không cần các bước trước.';

-- Nguyễn Gia Luân: Giám đốc (quyền tối cao)
update public.profiles set is_director = true where full_name = 'Nguyễn Gia Luân';

create or replace function private.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_director from public.profiles where id = (select auth.uid())), false);
$$;

-- ───────────────────────── Người duyệt theo dự án ─────────────────────────
create table if not exists public.project_approvers (
  project_id uuid not null references public.projects (id) on delete cascade,
  role text not null check (role in ('pic', 'technical', 'material', 'accounting', 'leader', 'admin_office')),
  employee_id text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, role, employee_id)
);
create index if not exists project_approvers_employee_idx on public.project_approvers (employee_id);
comment on table public.project_approvers is 'Người ký từng vai trò của riêng một dự án; thay cho bộ phận chung khi có.';
alter table public.project_approvers enable row level security;

create or replace function private.is_project_approver(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pid is not null and (select private.my_employee_id()) is not null
    and exists (select 1 from public.project_approvers a where a.project_id = pid and a.employee_id = (select private.my_employee_id()));
$$;

create or replace function private.can_view_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.has_access('projects.view'))
    or (select private.is_project_pm(pid))
    or (select private.is_director())
    or (select private.is_project_approver(pid))
    or exists (
      select 1 from public.project_members m
      where m.project_id = pid and m.role <> 'worker' and m.employee_id = (select private.my_employee_id())
    );
$$;

create or replace function private.can_see_budget(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_see_money(pid)) or (select private.in_any_department()) or (select private.has_access('purchases.view'))
    or (select private.is_director()) or (select private.is_project_approver(pid));
$$;

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
      or (select private.is_director())
      or (select private.is_purchase_approver())
      or (select private.has_access('purchases.view'))
      or (select private.is_purchase_payer())
      or (select private.in_any_department())
      or (o.project_id is not null and ((select private.is_project_lead(o.project_id)) or (select private.is_project_approver(o.project_id))))
    )
  );
$$;

-- Ai sửa danh sách người duyệt: Admin, Giám đốc, quyền quản lý dự án, PM của dự án.
create or replace function private.can_edit_approvers(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_director()) or (select private.can_manage_projects()) or (select private.is_project_pm(pid));
$$;

drop policy if exists "project_approvers: đọc" on public.project_approvers;
create policy "project_approvers: đọc" on public.project_approvers for select to authenticated using ((select private.can_view_project(project_id)));
drop policy if exists "project_approvers: thêm" on public.project_approvers;
create policy "project_approvers: thêm" on public.project_approvers for insert to authenticated with check ((select private.can_edit_approvers(project_id)));
drop policy if exists "project_approvers: xóa" on public.project_approvers;
create policy "project_approvers: xóa" on public.project_approvers for delete to authenticated using ((select private.can_edit_approvers(project_id)));

-- Danh sách người duyệt của dự án kèm tên (người không xem được hồ sơ nhân sự vẫn thấy tên).
create or replace function public.project_approvers_of(p_project uuid)
returns table (role text, employee_id text, code text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.role, a.employee_id, coalesce(e.code, ''), coalesce(e.doc ->> 'name', e.code, a.employee_id)
  from public.project_approvers a left join public.employees e on e.id = a.employee_id
  where a.project_id = p_project and (select private.can_view_project(p_project))
  order by a.role, a.created_at;
$$;

-- Thay toàn bộ người duyệt của dự án. p_items: [{"role":"leader","employeeId":"…"}]
create or replace function public.project_approvers_set(p_project uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.can_edit_approvers(p_project)) then raise exception 'FORBIDDEN'; end if;
  delete from public.project_approvers where project_id = p_project;
  insert into public.project_approvers (project_id, role, employee_id)
  select distinct p_project, x ->> 'role', x ->> 'employeeId'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where x ->> 'role' in ('pic', 'technical', 'material', 'accounting', 'leader', 'admin_office') and coalesce(x ->> 'employeeId', '') <> '';
  perform private.log_event('project.approvers', 'project', p_project::text, jsonb_build_object('items', coalesce(p_items, '[]'::jsonb)));
end;
$$;

-- ───────────────────────── Vai trò ký ─────────────────────────
create or replace function private.project_role_assigned(p_role text, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project is not null and exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = p_role);
$$;

-- Admin, Giám đốc ký thay mọi bước. Dự án có đặt người cho vai trò thì chỉ những người đó; chưa đặt thì theo bộ phận chung.
create or replace function private.holds_step_role(p_role text, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.is_director())
    or (p_role = 'pic' and (select private.is_project_pm(p_project)))
    or ((select private.project_role_assigned(p_role, p_project))
        and exists (select 1 from public.project_approvers a where a.project_id = p_project and a.role = p_role and a.employee_id = (select private.my_employee_id())))
    or (p_role <> 'pic' and not (select private.project_role_assigned(p_role, p_project)) and (select private.in_department(p_role)));
$$;

-- Dựng chuỗi ký: bước bỏ qua khi vai trò không có ai (dự án không đặt, bộ phận chung trống).
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
  deps jsonb := coalesce((select departments from public.procurement_settings where id = 1), '{}'::jsonb);
  start date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  target date;
  i int;
  k int;
  skipped boolean;
begin
  delete from public.approval_steps where doc_type = p_type and doc_id = p_doc;
  for i in 1 .. array_length(roles, 1) loop
    skipped := roles[i] <> 'pic'
      and not (select private.project_role_assigned(roles[i], p_project))
      and jsonb_array_length(coalesce(deps -> roles[i], '[]'::jsonb)) = 0
      and not (roles[i] = 'leader' and cardinality(coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')) > 0);
    target := start;
    for k in 1 .. days[i] loop target := private.next_workday(target); end loop;
    insert into public.approval_steps (doc_type, doc_id, project_id, seq, role, target_date, result)
    values (p_type, p_doc, p_project, i, roles[i], target, case when skipped then 'skipped' else 'pending' end);
  end loop;
end;
$$;

-- Giám đốc duyệt ngay: các bước chờ trước bước Lãnh đạo thành "bỏ qua" (ghi chú Giám đốc duyệt vượt cấp),
-- rồi ký bước Lãnh đạo bằng chính hàm ký (chạy đủ kiểm tra ngân sách, đổi trạng thái phiếu).
create or replace function public.approval_director_approve(p_type text, p_doc uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  leader_step public.approval_steps;
begin
  if not (select private.is_director()) then raise exception 'NOT_DIRECTOR'; end if;
  if exists (select 1 from public.approval_steps where doc_type = p_type and doc_id = p_doc and result = 'returned') then raise exception 'STEP_NOT_CURRENT'; end if;
  select * into leader_step from public.approval_steps where doc_type = p_type and doc_id = p_doc and role = 'leader' for update;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  if leader_step.result <> 'pending' then raise exception 'STEP_NOT_CURRENT'; end if;
  -- Không báo "cần duyệt" cho bước Lãnh đạo khi Giám đốc ký ngay sau đó
  perform set_config('app.skip_notify', '1', true);
  update public.approval_steps set result = 'skipped', note = 'Giám đốc duyệt vượt cấp', acted_at = now()
  where doc_type = p_type and doc_id = p_doc and result = 'pending' and seq < leader_step.seq;
  perform set_config('app.skip_notify', '', true);
  perform public.approval_sign(leader_step.id, true, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Giám đốc duyệt'));
end;
$$;

-- ───────────────────────── Thông báo ─────────────────────────
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval_pending', 'approval_returned', 'approval_approved')),
  step_id uuid,
  doc_type text,
  doc_id uuid,
  project_id uuid,
  title text not null,
  body text not null default '',
  link text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  unique (user_id, step_id, kind)
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
create index if not exists user_notifications_email_idx on public.user_notifications (created_at) where emailed_at is null;
alter table public.user_notifications enable row level security;
drop policy if exists "user_notifications: của mình" on public.user_notifications;
create policy "user_notifications: của mình" on public.user_notifications for select to authenticated using (user_id = (select auth.uid()));

-- Tài khoản giữ vai trò ký của một bước (để gửi thông báo). Không có ai thì báo Admin.
create or replace function private.step_holder_users(p_role text, p_project uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emps text[];
begin
  if p_role = 'pic' then
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
    where (pr.employee_id = any (emps) and pr.role <> 'pending')
       or (p_role = 'leader' and pr.is_director)
       or (p_role = 'leader' and not (select private.project_role_assigned('leader', p_project)) and pr.role in ('hr', 'engineer', 'employee') and 'purchases.approve' = any (coalesce(pr.permissions, '{}')));
  if not found then
    return query select pr.id from public.profiles pr where pr.role = 'admin';
  end if;
end;
$$;

create or replace function private.step_doc_title(p_type text, p_doc uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_type
    when 'purchase' then (select o.code || ' · ' || o.title from public.purchase_orders o where o.id = p_doc)
    when 'payment' then (select pp.rfp_no || ' · ' || o.code || ' · ' || o.title from public.purchase_payments pp join public.purchase_orders o on o.id = pp.order_id where pp.id = p_doc)
    when 'explanatory' then (select r.number || ' · ' || left(r.explanation, 60) from public.explanatory_reports r where r.id = p_doc)
    when 'material' then (select m.number from public.material_requests m where m.id = p_doc)
    when 'contract' then (select 'Xác nhận dự án lần ' || k.revision from public.project_contracts k where k.id = p_doc)
    else (select 'Ngân sách ' || b.number from public.project_budget_sheets b where b.id = p_doc) end, '');
$$;

create or replace function private.step_doc_creator(p_type text, p_doc uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'purchase' then (select o.requester_id from public.purchase_orders o where o.id = p_doc)
    when 'payment' then (select pp.requested_by from public.purchase_payments pp where pp.id = p_doc)
    when 'explanatory' then (select r.created_by from public.explanatory_reports r where r.id = p_doc)
    when 'material' then (select m.requester_id from public.material_requests m where m.id = p_doc)
    when 'contract' then (select k.created_by from public.project_contracts k where k.id = p_doc)
    else (select b.created_by from public.project_budget_sheets b where b.id = p_doc) end;
$$;

-- Đường dẫn mở phiếu trong app.
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
    else case when p_project is null then '' else '/du-an/' || p_project::text || '?muc=' || case p_type when 'material' then 'yeu-cau-vat-tu' when 'contract' then 'hop-dong' else 'ngan-sach' end end
  end;
$$;

-- Sau mỗi lần thêm / đổi bước ký: báo người đến lượt; trả về hoặc Lãnh đạo ký thì báo người lập.
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
  doc_title text := private.step_doc_title(new.doc_type, new.doc_id);
  pcode text := coalesce((select p.code from public.projects p where p.id = new.project_id), '');
  link text := private.step_doc_link(new.doc_type, new.doc_id, new.project_id);
  creator uuid;
begin
  if coalesce(current_setting('app.skip_notify', true), '') = '1' then return null; end if;
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
  if tg_op = 'UPDATE' and new.result = 'signed' and old.result <> 'signed' and new.role = 'leader' then
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
  role_label := case cur.role when 'pic' then 'Phụ trách' when 'technical' then 'P. Kỹ thuật' when 'material' then 'P. Vật tư' when 'accounting' then 'Kế toán'
    when 'leader' then 'Lãnh đạo' when 'admin_office' then 'Hành chánh' else cur.role end;
  insert into public.user_notifications (user_id, kind, step_id, doc_type, doc_id, project_id, title, body, link)
  select u, 'approval_pending', cur.id, cur.doc_type, cur.doc_id, cur.project_id, 'Cần bạn duyệt: ' || label,
    concat_ws(' · ', nullif(pcode, ''), nullif(doc_title, ''), 'ký với vai trò ' || role_label, 'hạn ' || to_char(cur.target_date, 'DD/MM/YYYY')), link
  from private.step_holder_users(cur.role, cur.project_id) u
  where u is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists approval_steps_notify on public.approval_steps;
create trigger approval_steps_notify after insert or update of result on public.approval_steps
  for each row execute function private.approval_steps_notify();

-- Thông báo của tôi (mới nhất trước).
create or replace function public.my_notifications(p_limit int default 30)
returns table (id uuid, kind text, title text, body text, link text, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at
  from public.user_notifications n
  where n.user_id = (select auth.uid())
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- Đánh dấu đã đọc (p_ids null = tất cả).
create or replace function public.notifications_mark_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- Thông tin tài khoản đang đăng nhập cho góc phải (chuông, hồ sơ).
create or replace function public.my_account()
returns table (full_name text, role text, is_director boolean, employee_id text, login_email text, notify_email text, notify_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name, p.role, p.is_director, p.employee_id, coalesce(u.email, '')::text, p.notify_email, p.notify_enabled
  from public.profiles p left join auth.users u on u.id = p.id
  where p.id = (select auth.uid());
$$;

-- Người dùng tự đặt email nhận thông báo.
create or replace function public.my_notify_settings_save(p_email text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  if mail <> '' and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'NOTIFY_EMAIL_INVALID'; end if;
  update public.profiles set notify_email = mail, notify_enabled = coalesce(p_enabled, true) where id = auth.uid();
end;
$$;

revoke all on function private.is_director(), private.is_project_approver(uuid), private.can_edit_approvers(uuid), private.project_role_assigned(text, uuid) from public, anon;
grant execute on function private.is_director(), private.is_project_approver(uuid), private.can_edit_approvers(uuid), private.project_role_assigned(text, uuid) to authenticated;
revoke all on function private.step_holder_users(text, uuid), private.step_doc_title(text, uuid), private.step_doc_creator(text, uuid), private.step_doc_link(text, uuid, uuid), private.approval_steps_notify() from public, anon, authenticated;
revoke all on function public.project_approvers_of(uuid), public.project_approvers_set(uuid, jsonb), public.approval_director_approve(text, uuid, text),
  public.my_notifications(int), public.notifications_mark_read(uuid[]), public.my_account(), public.my_notify_settings_save(text, boolean) from public, anon;
grant execute on function public.project_approvers_of(uuid), public.project_approvers_set(uuid, jsonb), public.approval_director_approve(text, uuid, text),
  public.my_notifications(int), public.notifications_mark_read(uuid[]), public.my_account(), public.my_notify_settings_save(text, boolean) to authenticated;
