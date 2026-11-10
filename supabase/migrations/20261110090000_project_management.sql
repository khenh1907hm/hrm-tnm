-- Quản lý dự án giai đoạn 1 (docs/dac-ta-quan-ly-du-an.md): dự án, ngân sách 4 khoản, thành viên dạng cây,
-- đơn giá giờ, chấm công ngày có duyệt, thầu phụ, phiếu chi, khóa sổ tháng.
--
-- Nguyên tắc quyền:
--  * Quyền trong dự án đi theo vai trò trong dự án (project_members.role), tài khoản nối với nhân sự qua profiles.employee_id.
--  * Tiền (đơn giá, thành tiền, ngân sách, chi phí) nằm ở bảng riêng, chỉ Admin và PM của dự án đọc được.
--    Tổ trưởng và CHT chỉ đọc được giờ công.
--  * Duyệt, từ chối, mở lại, tính tiền chỉ chạy qua hàm security definer, không ai sửa thẳng trạng thái "approved".
--  * Số giờ và số tiền là cột riêng (không để trong doc) để cộng báo cáo.

-- ───────────────────────── Liên kết tài khoản ↔ nhân sự, mục quyền mới ─────────────────────────
alter table public.profiles add column if not exists employee_id text references public.employees (id) on delete set null;
create unique index if not exists profiles_employee_id_key on public.profiles (employee_id) where employee_id is not null;
comment on column public.profiles.employee_id is 'Hồ sơ nhân sự của chủ tài khoản; quyết định vai trò trong từng dự án.';

alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles add constraint profiles_permissions_check check (permissions <@ array[
  'employees.view', 'employees.edit', 'employees.import', 'employees.export', 'employees.archive',
  'certificates.edit', 'certificateTypes.manage', 'reminders.manage',
  'signatures.manage', 'reports.manage', 'tools',
  'projects.view', 'projects.manage'
]::text[]);

-- HR mặc định đủ mọi mục, trừ Tạo/sửa dự án (spec 2.2: chỉ Admin tạo dự án).
create or replace function private.has_access(item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then true
      when p.role not in ('hr', 'engineer', 'employee') then false
      when p.permissions is not null then item = any (p.permissions)
      when p.role = 'hr' then item <> 'projects.manage'
      else item = 'tools'
    end
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

create or replace function private.my_employee_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select employee_id from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false);
$$;

-- ───────────────────────── Bảng ─────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(btrim(code)) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 300),
  customer_id uuid references public.partners (id) on delete set null,
  customer_name text not null default '',
  site text not null default '',
  pm_employee_id text references public.employees (id) on delete restrict,
  planned_start date not null,
  planned_end date not null,
  actual_start date,
  actual_end date,
  std_hours numeric(4, 2) not null default 8 check (std_hours > 0 and std_hours <= 12),
  weekly_off smallint[] not null default '{0}' check (weekly_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  status text not null default 'planning' check (status in ('planning', 'active', 'paused', 'done', 'archived')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_end >= planned_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start)
);
create unique index projects_code_key on public.projects (lower(btrim(code)));
create index projects_pm_idx on public.projects (pm_employee_id);
create index projects_customer_idx on public.projects (customer_id);
comment on table public.projects is 'Dự án / công trình. weekly_off: 0 = Chủ nhật … 6 = Thứ bảy.';

create table public.project_budgets (
  project_id uuid not null references public.projects (id) on delete cascade,
  category text not null check (category in ('labor', 'subcontract', 'material', 'other')),
  amount bigint not null default 0 check (amount >= 0),
  warn_pct smallint not null default 80 check (warn_pct between 1 and 100),
  planned_hours numeric(10, 1) check (planned_hours is null or planned_hours >= 0),
  primary key (project_id, category)
);
comment on table public.project_budgets is 'Ngân sách 4 khoản của dự án (VNĐ).';

create table public.project_budget_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  category text not null check (category in ('labor', 'subcontract', 'material', 'other')),
  old_amount bigint not null,
  new_amount bigint not null,
  reason text not null default '',
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index project_budget_changes_project_idx on public.project_budget_changes (project_id, changed_at desc);

create table public.subcontracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.partners (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  mode text not null check (mode in ('timesheet', 'lump_sum')),
  contract_no text not null default '',
  contract_value bigint not null default 0 check (contract_value >= 0),
  signed_on date,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index subcontracts_project_idx on public.subcontracts (project_id);
create index subcontracts_partner_idx on public.subcontracts (partner_id);

create table public.subcontract_payments (
  id uuid primary key default gen_random_uuid(),
  subcontract_id uuid not null references public.subcontracts (id) on delete cascade,
  pay_date date not null,
  amount bigint not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index subcontract_payments_sub_idx on public.subcontract_payments (subcontract_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete restrict,
  -- Tên và mã chụp lại lúc thêm: tổ trưởng không có quyền đọc bảng employees
  display_name text not null default '',
  employee_code text not null default '',
  role text not null check (role in ('pm', 'commander', 'supervisor', 'engineer', 'leader', 'worker')),
  parent_id uuid references public.project_members (id) on delete restrict,
  team text not null default '',
  subcontract_id uuid references public.subcontracts (id) on delete set null,
  joined_on date not null,
  left_on date,
  created_at timestamptz not null default now(),
  unique (project_id, employee_id),
  check (parent_id is null or parent_id <> id),
  check (left_on is null or left_on >= joined_on)
);
create index project_members_parent_idx on public.project_members (parent_id);
create index project_members_employee_idx on public.project_members (employee_id);
create index project_members_subcontract_idx on public.project_members (subcontract_id);
create index project_members_team_idx on public.project_members (project_id, team);
comment on column public.project_members.parent_id is 'Quản lý trực tiếp trong dự án; sơ đồ cây vẽ từ cột này.';

create table public.project_member_rates (
  member_id uuid primary key references public.project_members (id) on delete cascade,
  hourly_rate bigint not null check (hourly_rate >= 0)
);
comment on table public.project_member_rates is 'Đơn giá riêng trong dự án (ưu tiên hơn đơn giá chung).';

create table public.labor_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (id) on delete cascade,
  hourly_rate bigint not null check (hourly_rate >= 0),
  effective_from date not null,
  effective_to date,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
comment on table public.labor_rates is 'Đơn giá giờ chung của từng người, có lịch sử hiệu lực. Chỉ Admin đọc/ghi.';

create table public.labor_settings (
  id smallint primary key default 1 check (id = 1),
  ot_weekday numeric(4, 2) not null default 1.5,
  ot_weekly_off numeric(4, 2) not null default 2.0,
  ot_holiday numeric(4, 2) not null default 3.0,
  night_bonus numeric(4, 2) not null default 0.3,
  max_hours_day numeric(4, 1) not null default 12,
  max_ot_month numeric(5, 1) not null default 40,
  max_ot_year numeric(6, 1) not null default 200,
  backfill_days smallint not null default 3 check (backfill_days between 0 and 60),
  updated_at timestamptz not null default now()
);
insert into public.labor_settings (id) values (1) on conflict do nothing;
comment on table public.labor_settings is 'Hệ số tăng ca (Điều 98 BLLĐ 2019), trần giờ làm (Điều 107), số ngày tổ trưởng được nhập lùi.';

create table public.holidays (
  day date primary key,
  name text not null default ''
);

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  work_date date not null,
  team text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  created_by uuid default auth.uid(),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  reject_reason text not null default '',
  updated_at timestamptz not null default now(),
  unique (project_id, work_date, team)
);
create index timesheets_project_date_idx on public.timesheets (project_id, work_date);
comment on table public.timesheets is 'Phiếu công ngày: một tổ, một dự án, một ngày.';

create table public.timesheet_lines (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references public.timesheets (id) on delete cascade,
  employee_id text not null references public.employees (id) on delete restrict,
  attendance text not null default 'present' check (attendance in ('present', 'leave', 'absent', 'holiday')),
  regular_hours numeric(4, 1) not null default 0 check (regular_hours between 0 and 24 and regular_hours * 2 = floor(regular_hours * 2)),
  ot_hours numeric(4, 1) not null default 0 check (ot_hours between 0 and 24 and ot_hours * 2 = floor(ot_hours * 2)),
  ot_type text not null default 'weekday' check (ot_type in ('weekday', 'weekly_off', 'holiday')),
  night_hours numeric(4, 1) not null default 0 check (night_hours between 0 and 24),
  note text not null default '',
  unique (timesheet_id, employee_id),
  check (attendance = 'present' or (regular_hours = 0 and ot_hours = 0 and night_hours = 0)),
  check (attendance <> 'present' or regular_hours + ot_hours > 0)
);
create index timesheet_lines_employee_idx on public.timesheet_lines (employee_id);

create table public.timesheet_costs (
  line_id uuid primary key references public.timesheet_lines (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  work_date date not null,
  employee_id text not null,
  category text not null check (category in ('labor', 'subcontract')),
  rate bigint,
  ot_multiplier numeric(4, 2) not null,
  night_bonus numeric(4, 2) not null,
  amount bigint not null,
  computed_at timestamptz not null default now()
);
create index timesheet_costs_project_date_idx on public.timesheet_costs (project_id, work_date);
comment on table public.timesheet_costs is 'Tiền công chụp cố định lúc duyệt. rate null = thiếu đơn giá (amount = 0).';

create table public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  spent_on date not null,
  category text not null check (category in ('material', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  supplier text not null default '',
  amount bigint not null check (amount > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index project_expenses_project_idx on public.project_expenses (project_id, spent_on);

create table public.period_locks (
  project_id uuid not null references public.projects (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  locked_by uuid default auth.uid(),
  locked_at timestamptz not null default now(),
  primary key (project_id, month)
);

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger timesheets_touch before update on public.timesheets for each row execute function public.touch_updated_at();

-- ───────────────────────── Hàm quyền theo dự án ─────────────────────────
create or replace function private.project_roles(pid uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.role), '{}')
  from public.project_members m
  where m.project_id = pid and m.employee_id = (select private.my_employee_id());
$$;

-- PM: người đứng tên PM của dự án, hoặc thành viên vai trò pm. Admin luôn đạt.
create or replace function private.is_project_pm(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or exists (select 1 from public.projects p where p.id = pid and p.pm_employee_id is not null and p.pm_employee_id = (select private.my_employee_id()))
    or 'pm' = any (private.project_roles(pid));
$$;

-- PM hoặc Chỉ huy trưởng: duyệt chấm công, xếp thành viên.
create or replace function private.is_project_lead(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_project_pm(pid)) or 'commander' = any (private.project_roles(pid));
$$;

create or replace function private.leads_team(pid uuid, p_team text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.role = 'leader' and m.team = p_team and p_team <> ''
      and m.employee_id = (select private.my_employee_id())
  );
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
    or exists (
      select 1 from public.project_members m
      where m.project_id = pid and m.role <> 'worker' and m.employee_id = (select private.my_employee_id())
    );
$$;

create or replace function private.can_manage_projects()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.has_access('projects.manage'));
$$;

create or replace function private.is_locked(pid uuid, d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.period_locks l where l.project_id = pid and l.month = to_char(d, 'YYYY-MM'));
$$;

-- Ai xem được phiếu: người xem dự án nói chung (trừ tổ trưởng chỉ thấy tổ mình).
create or replace function private.can_view_timesheet(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.timesheets t
    where t.id = tid and (
      (select private.is_project_lead(t.project_id))
      or (select private.has_access('projects.view'))
      or (select private.leads_team(t.project_id, t.team))
    )
  );
$$;

-- Ai sửa được dòng công: tổ trưởng khi phiếu nháp/bị từ chối; CHT, PM khi phiếu chưa duyệt. Tháng khóa sổ thì không ai sửa.
create or replace function private.can_edit_timesheet(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.timesheets t
    where t.id = tid
      and not (select private.is_locked(t.project_id, t.work_date))
      and (
        ((select private.is_project_lead(t.project_id)) and t.status in ('draft', 'submitted', 'rejected'))
        or ((select private.leads_team(t.project_id, t.team)) and t.status in ('draft', 'rejected'))
      )
  );
$$;

revoke all on function private.my_employee_id(), private.is_admin(), private.project_roles(uuid), private.is_project_pm(uuid), private.is_project_lead(uuid),
  private.leads_team(uuid, text), private.can_view_project(uuid), private.can_manage_projects(), private.is_locked(uuid, date),
  private.can_view_timesheet(uuid), private.can_edit_timesheet(uuid) from public, anon;
grant execute on function private.my_employee_id(), private.is_admin(), private.project_roles(uuid), private.is_project_pm(uuid), private.is_project_lead(uuid),
  private.leads_team(uuid, text), private.can_view_project(uuid), private.can_manage_projects(), private.is_locked(uuid, date),
  private.can_view_timesheet(uuid), private.can_edit_timesheet(uuid) to authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.projects enable row level security;
alter table public.project_budgets enable row level security;
alter table public.project_budget_changes enable row level security;
alter table public.subcontracts enable row level security;
alter table public.subcontract_payments enable row level security;
alter table public.project_members enable row level security;
alter table public.project_member_rates enable row level security;
alter table public.labor_rates enable row level security;
alter table public.labor_settings enable row level security;
alter table public.holidays enable row level security;
alter table public.timesheets enable row level security;
alter table public.timesheet_lines enable row level security;
alter table public.timesheet_costs enable row level security;
alter table public.project_expenses enable row level security;
alter table public.period_locks enable row level security;

create policy "projects: đọc" on public.projects for select to authenticated using ((select private.can_view_project(id)));
create policy "projects: thêm" on public.projects for insert to authenticated with check ((select private.can_manage_projects()));
create policy "projects: sửa" on public.projects for update to authenticated
  using ((select private.can_manage_projects()) or (select private.is_project_pm(id)))
  with check ((select private.can_manage_projects()) or (select private.is_project_pm(id)));

-- Ngân sách và mọi khoản tiền: Admin và PM của dự án
create policy "project_budgets: đọc" on public.project_budgets for select to authenticated using ((select private.is_project_pm(project_id)));
create policy "project_budgets: ghi" on public.project_budgets for all to authenticated
  using ((select private.is_project_pm(project_id)) or (select private.can_manage_projects()))
  with check ((select private.is_project_pm(project_id)) or (select private.can_manage_projects()));
create policy "project_budget_changes: đọc" on public.project_budget_changes for select to authenticated using ((select private.is_project_pm(project_id)));
create policy "project_budget_changes: thêm" on public.project_budget_changes for insert to authenticated
  with check ((select private.is_project_pm(project_id)) or (select private.can_manage_projects()));

create policy "subcontracts: đọc" on public.subcontracts for select to authenticated using ((select private.is_project_lead(project_id)));
create policy "subcontracts: ghi" on public.subcontracts for all to authenticated using ((select private.is_project_pm(project_id))) with check ((select private.is_project_pm(project_id)));
create policy "subcontract_payments: đọc ghi" on public.subcontract_payments for all to authenticated
  using (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.is_project_pm(s.project_id))))
  with check (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.is_project_pm(s.project_id))));

create policy "project_members: đọc" on public.project_members for select to authenticated
  using ((select private.can_view_project(project_id)) or (select private.leads_team(project_id, team)));
create policy "project_members: thêm" on public.project_members for insert to authenticated
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
create policy "project_members: sửa" on public.project_members for update to authenticated
  using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()))
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
create policy "project_members: xóa" on public.project_members for delete to authenticated
  using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));

create policy "project_member_rates: đọc ghi" on public.project_member_rates for all to authenticated
  using (exists (select 1 from public.project_members m where m.id = member_id and (select private.is_project_pm(m.project_id))))
  with check (exists (select 1 from public.project_members m where m.id = member_id and (select private.is_project_pm(m.project_id))));

create policy "labor_rates: admin" on public.labor_rates for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "labor_settings: đọc" on public.labor_settings for select to authenticated using (true);
create policy "labor_settings: sửa" on public.labor_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "holidays: đọc" on public.holidays for select to authenticated using (true);
create policy "holidays: ghi" on public.holidays for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Phiếu công: lập ở trạng thái nháp; gửi/duyệt/từ chối/mở lại chỉ qua hàm bên dưới
create policy "timesheets: đọc" on public.timesheets for select to authenticated using ((select private.can_view_timesheet(id)));
create policy "timesheets: thêm" on public.timesheets for insert to authenticated
  with check (status = 'draft' and not (select private.is_locked(project_id, work_date))
    and ((select private.is_project_lead(project_id)) or (select private.leads_team(project_id, team))));
create policy "timesheets: sửa nháp" on public.timesheets for update to authenticated
  using ((select private.can_edit_timesheet(id)))
  with check (status in ('draft', 'submitted', 'rejected') and (select private.can_edit_timesheet(id)));
create policy "timesheets: xóa nháp" on public.timesheets for delete to authenticated
  using (status = 'draft' and (select private.can_edit_timesheet(id)));

create policy "timesheet_lines: đọc" on public.timesheet_lines for select to authenticated using ((select private.can_view_timesheet(timesheet_id)));
create policy "timesheet_lines: thêm" on public.timesheet_lines for insert to authenticated with check ((select private.can_edit_timesheet(timesheet_id)));
create policy "timesheet_lines: sửa" on public.timesheet_lines for update to authenticated using ((select private.can_edit_timesheet(timesheet_id))) with check ((select private.can_edit_timesheet(timesheet_id)));
create policy "timesheet_lines: xóa" on public.timesheet_lines for delete to authenticated using ((select private.can_edit_timesheet(timesheet_id)));

-- Tiền công: chỉ đọc, ghi qua hàm duyệt
create policy "timesheet_costs: đọc" on public.timesheet_costs for select to authenticated using ((select private.is_project_pm(project_id)));

create policy "project_expenses: đọc ghi" on public.project_expenses for all to authenticated
  using ((select private.is_project_pm(project_id))) with check ((select private.is_project_pm(project_id)));

create policy "period_locks: đọc" on public.period_locks for select to authenticated using ((select private.can_view_project(project_id)));
create policy "period_locks: ghi" on public.period_locks for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Không cho tổ trưởng tự đổi trạng thái phiếu sang approved/rejected/submitted qua update thường
create or replace function private.guard_timesheet_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('tnm.timesheet_rpc', true), '') <> 'on' then
    raise exception 'TS_STATUS_RPC_ONLY';
  end if;
  return new;
end;
$$;
create trigger timesheets_guard_status before update on public.timesheets for each row execute function private.guard_timesheet_status();

-- ───────────────────────── Hàm nghiệp vụ ─────────────────────────
-- Ghi nhật ký cùng dạng với AuditEvent phía app (doc gồm role, before, after).
create or replace function private.log_event(p_action text, p_entity_type text, p_entity_id text, p_after jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := gen_random_uuid()::text;
  v_actor text := coalesce(auth.uid()::text, 'system');
  v_role text := coalesce((select role from public.profiles where id = auth.uid()), 'system');
begin
  insert into public.audit_events (id, at, actor_id, action, entity_type, entity_id, doc)
  values (v_id, now(), v_actor, p_action, p_entity_type, p_entity_id,
    jsonb_build_object('id', v_id, 'at', now(), 'actorId', v_actor, 'role', v_role, 'action', p_action,
      'entityType', p_entity_type, 'entityId', p_entity_id, 'before', null, 'after', p_after));
end;
$$;
revoke all on function private.log_event(text, text, text, jsonb) from public, anon, authenticated;
-- Gửi duyệt: kiểm tra ngày, dự án đang thi công, khoảng thành viên, quá 24 giờ trên mọi dự án (TS-01..03, TS-08).
create or replace function public.submit_timesheet(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  p public.projects;
  s public.labor_settings;
  bad text;
begin
  select * into t from public.timesheets where id = p_id for update;
  if not found then raise exception 'TS_NOT_FOUND'; end if;
  if not ((select private.is_project_lead(t.project_id)) or ((select private.leads_team(t.project_id, t.team)) and t.status in ('draft', 'rejected'))) then
    raise exception 'FORBIDDEN';
  end if;
  if t.status not in ('draft', 'rejected') then raise exception 'TS_NOT_EDITABLE'; end if;
  select * into p from public.projects where id = t.project_id;
  select * into s from public.labor_settings where id = 1;
  if p.status <> 'active' then raise exception 'TS_PROJECT_NOT_ACTIVE'; end if;
  if t.work_date < p.planned_start or t.work_date > coalesce(p.actual_end, greatest(p.planned_end, current_date)) then raise exception 'TS_OUTSIDE_PROJECT'; end if;
  if t.work_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'TS_FUTURE_DATE'; end if;
  if (select private.is_locked(t.project_id, t.work_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;
  if not (select private.is_project_lead(t.project_id)) and t.work_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date - s.backfill_days then
    raise exception 'TS_BACKFILL_LIMIT';
  end if;
  if not exists (select 1 from public.timesheet_lines where timesheet_id = p_id) then raise exception 'TS_EMPTY'; end if;

  select coalesce(m.display_name, l.employee_id) into bad
  from public.timesheet_lines l
  left join public.project_members m on m.project_id = t.project_id and m.employee_id = l.employee_id
  where l.timesheet_id = p_id and (m.id is null or t.work_date < m.joined_on or (m.left_on is not null and t.work_date > m.left_on))
  limit 1;
  if bad is not null then raise exception 'TS_OUTSIDE_MEMBERSHIP:%', bad; end if;

  select coalesce(m.display_name, l.employee_id) into bad
  from public.timesheet_lines l
  left join public.project_members m on m.project_id = t.project_id and m.employee_id = l.employee_id
  where l.timesheet_id = p_id
    and l.regular_hours + l.ot_hours + coalesce((
      select sum(o.regular_hours + o.ot_hours) from public.timesheet_lines o join public.timesheets ot on ot.id = o.timesheet_id
      where o.employee_id = l.employee_id and ot.work_date = t.work_date and ot.id <> p_id and ot.status in ('submitted', 'approved')
    ), 0) > 24
  limit 1;
  if bad is not null then raise exception 'TS_DAY_OVER_24:%', bad; end if;

  perform set_config('tnm.timesheet_rpc', 'on', true);
  update public.timesheets set status = 'submitted', submitted_at = now(), reject_reason = '' where id = p_id;
end;
$$;

-- Tính tiền một phiếu (dùng khi duyệt và khi Admin bấm "Tính lại").
create or replace function private.compute_timesheet_costs(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  s public.labor_settings;
begin
  select * into t from public.timesheets where id = p_id;
  select * into s from public.labor_settings where id = 1;
  delete from public.timesheet_costs where line_id in (select id from public.timesheet_lines where timesheet_id = p_id);
  insert into public.timesheet_costs (line_id, project_id, work_date, employee_id, category, rate, ot_multiplier, night_bonus, amount)
  select l.id, t.project_id, t.work_date, l.employee_id,
    case when m.subcontract_id is null then 'labor' else 'subcontract' end,
    r.rate,
    case l.ot_type when 'weekly_off' then s.ot_weekly_off when 'holiday' then s.ot_holiday else s.ot_weekday end,
    s.night_bonus,
    case when l.attendance <> 'present' or r.rate is null then 0
      else round(r.rate * (l.regular_hours
        + l.ot_hours * case l.ot_type when 'weekly_off' then s.ot_weekly_off when 'holiday' then s.ot_holiday else s.ot_weekday end
        + l.night_hours * s.night_bonus))::bigint end
  from public.timesheet_lines l
  left join public.project_members m on m.project_id = t.project_id and m.employee_id = l.employee_id
  left join lateral (
    select coalesce(
      (select pr.hourly_rate from public.project_member_rates pr where pr.member_id = m.id),
      (select lr.hourly_rate from public.labor_rates lr
        where lr.employee_id = l.employee_id and lr.effective_from <= t.work_date and (lr.effective_to is null or lr.effective_to >= t.work_date)
        order by lr.effective_from desc limit 1)
    ) as rate
  ) r on true
  where l.timesheet_id = p_id;
end;
$$;
revoke all on function private.compute_timesheet_costs(uuid) from public, anon, authenticated;

create or replace function public.approve_timesheet(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t public.timesheets;
begin
  select * into t from public.timesheets where id = p_id for update;
  if not found then raise exception 'TS_NOT_FOUND'; end if;
  if not (select private.is_project_lead(t.project_id)) then raise exception 'FORBIDDEN'; end if;
  if t.status <> 'submitted' then raise exception 'TS_NOT_SUBMITTED'; end if;
  if (select private.is_locked(t.project_id, t.work_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;
  perform private.compute_timesheet_costs(p_id);
  perform set_config('tnm.timesheet_rpc', 'on', true);
  update public.timesheets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform private.log_event('timesheet.approve', 'timesheet', p_id::text, jsonb_build_object('projectId', t.project_id, 'workDate', t.work_date, 'team', t.team));
end;
$$;

create or replace function public.reject_timesheet(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t public.timesheets;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'TS_REJECT_REASON'; end if;
  select * into t from public.timesheets where id = p_id for update;
  if not found then raise exception 'TS_NOT_FOUND'; end if;
  if not (select private.is_project_lead(t.project_id)) then raise exception 'FORBIDDEN'; end if;
  if t.status <> 'submitted' then raise exception 'TS_NOT_SUBMITTED'; end if;
  perform set_config('tnm.timesheet_rpc', 'on', true);
  update public.timesheets set status = 'rejected', reject_reason = btrim(p_reason) where id = p_id;
end;
$$;

-- Admin mở lại phiếu đã duyệt (kèm lý do, ghi nhật ký); tiền công bị gỡ cho tới khi duyệt lại.
create or replace function public.reopen_timesheet(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t public.timesheets;
begin
  if not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'TS_REOPEN_REASON'; end if;
  select * into t from public.timesheets where id = p_id for update;
  if not found then raise exception 'TS_NOT_FOUND'; end if;
  if t.status <> 'approved' then raise exception 'TS_NOT_APPROVED'; end if;
  if (select private.is_locked(t.project_id, t.work_date)) then raise exception 'TS_PERIOD_LOCKED'; end if;
  delete from public.timesheet_costs where line_id in (select id from public.timesheet_lines where timesheet_id = p_id);
  perform set_config('tnm.timesheet_rpc', 'on', true);
  update public.timesheets set status = 'submitted', approved_by = null, approved_at = null where id = p_id;
  perform private.log_event('timesheet.reopen', 'timesheet', p_id::text, jsonb_build_object('reason', btrim(p_reason), 'projectId', t.project_id, 'workDate', t.work_date));
end;
$$;

-- Admin tính lại tiền cho các phiếu đã duyệt trong khoảng ngày chưa khóa sổ (sau khi đổi đơn giá hiệu lực lùi).
create or replace function public.recalc_project_costs(p_project uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  n integer := 0;
begin
  if not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  for rec in select id, work_date from public.timesheets where project_id = p_project and status = 'approved' and work_date between p_from and p_to loop
    if not (select private.is_locked(p_project, rec.work_date)) then
      perform private.compute_timesheet_costs(rec.id);
      n := n + 1;
    end if;
  end loop;
  perform private.log_event('project.recalc', 'project', p_project::text, jsonb_build_object('from', p_from, 'to', p_to, 'timesheets', n));
  return n;
end;
$$;

revoke all on function public.submit_timesheet(uuid), public.approve_timesheet(uuid), public.reject_timesheet(uuid, text),
  public.reopen_timesheet(uuid, text), public.recalc_project_costs(uuid, date, date) from public, anon;
grant execute on function public.submit_timesheet(uuid), public.approve_timesheet(uuid), public.reject_timesheet(uuid, text),
  public.reopen_timesheet(uuid, text), public.recalc_project_costs(uuid, date, date) to authenticated;

-- Admin mở khóa sổ một tháng (kèm lý do, ghi nhật ký).
create or replace function public.unlock_period(p_project uuid, p_month text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'PERIOD_UNLOCK_REASON'; end if;
  delete from public.period_locks where project_id = p_project and month = p_month;
  perform private.log_event('period.unlock', 'project', p_project::text, jsonb_build_object('month', p_month, 'reason', btrim(p_reason)));
end;
$$;
revoke all on function public.unlock_period(uuid, text, text) from public, anon;
grant execute on function public.unlock_period(uuid, text, text) to authenticated;
