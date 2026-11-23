-- Chức danh công ty (Quy trình duyệt → Chức danh):
--  * Sếp (leader): chỉ 1 người.
--  * Nhân sự (hr): người giữ chức danh này tự có vai trò tài khoản "hr" (quyền nhân sự mặc định).
--    Bỏ khỏi chức danh thì trở về "employee" (chỉ với người từng được gán qua chức danh). Admin giữ nguyên.
--  * Mặc định: Nhân sự = Phạm Quốc Tùng (TNM0002).

create or replace function public.approval_settings_save(p_departments jsonb, p_modes jsonb, p_stages jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_hr jsonb;
  v_new_hr jsonb;
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_departments, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_modes, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_stages, '{}'::jsonb)) <> 'object' then raise exception 'BAD_INPUT'; end if;
  if p_departments is not null and jsonb_typeof(coalesce(p_departments -> 'leader', '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_departments -> 'leader', '[]'::jsonb)) > 1 then raise exception 'LEADER_ONLY_ONE'; end if;
  select coalesce(departments -> 'hr', '[]'::jsonb) into v_old_hr from public.procurement_settings where id = 1;
  update public.procurement_settings set departments = coalesce(p_departments, departments),
    modes = case when p_modes is null then modes else
      (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_modes) x(k, v) where v in ('any', 'sequence')) end,
    stage_departments = case when p_stages is null then stage_departments else
      (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each_text(p_stages) x(k, v)
       where k in ('draft', 'submitted', 'approved', 'po', 'advance', 'advance_pay', 'ordered', 'prepayment', 'prepayment_pay', 'received', 'stocked', 'final', 'final_pay')
         and v in ('', 'pic', 'technical', 'material', 'warehouse', 'accounting', 'leader')) end,
    updated_at = now()
  where id = 1;
  if p_departments is not null then
    v_new_hr := coalesce(p_departments -> 'hr', '[]'::jsonb);
    update public.profiles set role = 'hr'
      where employee_id is not null and v_new_hr ? employee_id::text and role in ('employee', 'engineer');
    update public.profiles set role = 'employee'
      where employee_id is not null and v_old_hr ? employee_id::text and not v_new_hr ? employee_id::text and role = 'hr';
  end if;
  perform private.log_event('approval.settings', 'procurement_settings', '1', jsonb_build_object('departments', p_departments, 'modes', p_modes, 'stages', p_stages));
end;
$$;

-- Tài khoản liên kết hồ sơ đang giữ chức danh Nhân sự: tự lên vai trò hr
create or replace function private.sync_hr_department_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employee_id is not null and new.role in ('employee', 'engineer')
    and coalesce((select departments -> 'hr' from public.procurement_settings where id = 1), '[]'::jsonb) ? new.employee_id::text then
    new.role := 'hr';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_sync_hr_department on public.profiles;
create trigger profiles_sync_hr_department before insert or update of employee_id, role on public.profiles
  for each row execute function private.sync_hr_department_role();

-- Mặc định: Nhân sự = Phạm Quốc Tùng
update public.procurement_settings s
  set departments = s.departments || jsonb_build_object('hr', coalesce((select jsonb_agg(e.id) from public.employees e where e.code = 'TNM0002'), '[]'::jsonb))
  where s.id = 1 and jsonb_array_length(coalesce(s.departments -> 'hr', '[]'::jsonb)) = 0;
update public.profiles p set role = 'hr'
  where p.role in ('employee', 'engineer') and p.employee_id is not null
    and coalesce((select departments -> 'hr' from public.procurement_settings where id = 1), '[]'::jsonb) ? p.employee_id::text;
