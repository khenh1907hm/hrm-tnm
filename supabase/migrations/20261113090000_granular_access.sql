-- Chia nhỏ quyền theo chức năng (Tài khoản & phân quyền):
--  * projects.finance: xem/sửa vốn, ngân sách, đơn giá riêng, tiền công, chi phí của MỌI dự án (ngoài Admin, PM, CHT của dự án).
--  * projects.rates: quản lý đơn giá nhân công, hệ số tăng ca, ngày lễ (trước đây chỉ Admin).
--  * purchases.approve: duyệt đơn hàng và khoản chi (ngoài danh sách người duyệt trong purchase_settings).
-- HR mặc định KHÔNG có 4 mục: projects.manage, projects.finance, projects.rates, purchases.approve (Admin tick riêng nếu cần).

alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles add constraint profiles_permissions_check check (permissions <@ array[
  'employees.view', 'employees.edit', 'employees.import', 'employees.export', 'employees.archive',
  'certificates.edit', 'certificateTypes.manage', 'reminders.manage',
  'signatures.manage', 'reports.manage', 'tools',
  'projects.view', 'projects.manage', 'projects.finance', 'projects.rates',
  'purchases.view', 'purchases.approve', 'purchases.pay'
]::text[]);

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
      when p.role = 'hr' then item not in ('projects.manage', 'projects.finance', 'projects.rates', 'purchases.approve')
      else item = 'tools'
    end
    from public.profiles p
    where p.id = (select auth.uid())
  ), false);
$$;

-- Ai xem được tiền của một dự án: Admin, PM, CHT của dự án, hoặc người có mục projects.finance.
create or replace function private.can_see_money(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_project_lead(pid)) or (select private.has_access('projects.finance'));
$$;
revoke all on function private.can_see_money(uuid) from public, anon;
grant execute on function private.can_see_money(uuid) to authenticated;

drop policy "project_finance: đọc ghi" on public.project_finance;
create policy "project_finance: đọc ghi" on public.project_finance for all to authenticated
  using ((select private.can_see_money(project_id))) with check ((select private.can_see_money(project_id)));
drop policy "project_budgets: đọc" on public.project_budgets;
drop policy "project_budgets: ghi" on public.project_budgets;
create policy "project_budgets: đọc" on public.project_budgets for select to authenticated using ((select private.can_see_money(project_id)));
create policy "project_budgets: ghi" on public.project_budgets for all to authenticated
  using ((select private.can_see_money(project_id)) or (select private.can_manage_projects()))
  with check ((select private.can_see_money(project_id)) or (select private.can_manage_projects()));
drop policy "project_budget_changes: đọc" on public.project_budget_changes;
drop policy "project_budget_changes: thêm" on public.project_budget_changes;
create policy "project_budget_changes: đọc" on public.project_budget_changes for select to authenticated using ((select private.can_see_money(project_id)));
create policy "project_budget_changes: thêm" on public.project_budget_changes for insert to authenticated
  with check ((select private.can_see_money(project_id)) or (select private.can_manage_projects()));
drop policy "subcontracts: đọc" on public.subcontracts;
drop policy "subcontracts: ghi" on public.subcontracts;
create policy "subcontracts: đọc" on public.subcontracts for select to authenticated using ((select private.can_see_money(project_id)));
create policy "subcontracts: ghi" on public.subcontracts for all to authenticated using ((select private.can_see_money(project_id))) with check ((select private.can_see_money(project_id)));
drop policy "subcontract_payments: đọc ghi" on public.subcontract_payments;
create policy "subcontract_payments: đọc ghi" on public.subcontract_payments for all to authenticated
  using (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.can_see_money(s.project_id))))
  with check (exists (select 1 from public.subcontracts s where s.id = subcontract_id and (select private.can_see_money(s.project_id))));
drop policy "project_member_rates: đọc ghi" on public.project_member_rates;
create policy "project_member_rates: đọc ghi" on public.project_member_rates for all to authenticated
  using (exists (select 1 from public.project_members m where m.id = member_id and (select private.can_see_money(m.project_id))))
  with check (exists (select 1 from public.project_members m where m.id = member_id and (select private.can_see_money(m.project_id))));
drop policy "timesheet_costs: đọc" on public.timesheet_costs;
create policy "timesheet_costs: đọc" on public.timesheet_costs for select to authenticated using ((select private.can_see_money(project_id)));
drop policy "project_expenses: đọc ghi" on public.project_expenses;
create policy "project_expenses: đọc ghi" on public.project_expenses for all to authenticated
  using ((select private.can_see_money(project_id))) with check ((select private.can_see_money(project_id)));

-- Đơn giá, hệ số, ngày lễ: Admin hoặc projects.rates
create or replace function private.can_manage_rates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.has_access('projects.rates'));
$$;
revoke all on function private.can_manage_rates() from public, anon;
grant execute on function private.can_manage_rates() to authenticated;
drop policy "labor_rates: admin" on public.labor_rates;
create policy "labor_rates: quản lý đơn giá" on public.labor_rates for all to authenticated using ((select private.can_manage_rates())) with check ((select private.can_manage_rates()));
drop policy "labor_settings: sửa" on public.labor_settings;
create policy "labor_settings: sửa" on public.labor_settings for update to authenticated using ((select private.can_manage_rates())) with check ((select private.can_manage_rates()));
drop policy "holidays: ghi" on public.holidays;
create policy "holidays: ghi" on public.holidays for all to authenticated using ((select private.can_manage_rates())) with check ((select private.can_manage_rates()));

-- Người duyệt đơn hàng: trong danh sách người duyệt, hoặc được Admin tick RIÊNG mục purchases.approve
-- (Admin không tự động là người duyệt: đơn hàng phải do sếp duyệt).
create or replace function private.is_purchase_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.my_employee_id()) = any (coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')), false)
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('hr', 'engineer', 'employee') and 'purchases.approve' = any (coalesce(p.permissions, '{}')));
$$;
