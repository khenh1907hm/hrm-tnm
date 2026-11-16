-- Chức danh công ty và cây duyệt mặc định cho mọi dự án:
--  * Chức danh (procurement_settings.departments): Giám đốc (leader), Trưởng kỹ sư (technical), Kế toán (accounting),
--    Người duyệt đầu vào (intake, thuộc kế toán, kiểm soát chất lượng đầu vào), Kinh doanh (sales), Kho kiêm Vật tư (warehouse = material).
--    Ai không có chức danh là Kỹ sư.
--  * Giám đốc, Kế toán, Người duyệt đầu vào (và mọi chức danh) mặc định thấy mọi dự án, không cần thêm vào dự án.
--  * procurement_settings.trees: cây khối duyệt mặc định cho mọi dự án theo loại phiếu. Người trong khối là mã hồ sơ
--    hoặc "role:<chức danh>" (lấy người đang giữ chức danh lúc gửi phiếu). Dự án có cây riêng thì dùng cây riêng.
--  * Kế toán chi được khoản đã duyệt; Người duyệt đầu vào làm được Nhận hàng, Nhập kho (kiểm tra hàng về).

alter table public.procurement_settings add column if not exists trees jsonb not null default '{}'::jsonb check (jsonb_typeof(trees) = 'object');
comment on column public.procurement_settings.trees is 'Cây khối duyệt mặc định cho mọi dự án: {doc_type: [{name, mode, people: [employee_id | "role:<chức danh>"]}]}.';

-- Kho kiêm Vật tư: người của P. Vật tư = người của Kho
create or replace function private.in_department(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.my_employee_id()) is not null
      and (coalesce((select departments -> p_role from public.procurement_settings where id = 1), '[]'::jsonb) ? (select private.my_employee_id())
        or (p_role = 'material' and coalesce((select departments -> 'warehouse' from public.procurement_settings where id = 1), '[]'::jsonb) ? (select private.my_employee_id()))), false)
    or (p_role = 'leader' and (select private.is_purchase_approver()));
$$;

create or replace function private.in_any_department()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from unnest(array['leader', 'technical', 'material', 'warehouse', 'accounting', 'intake', 'sales']) r where (select private.in_department(r)));
$$;

create or replace function public.procurement_my_departments()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r), '{}') from unnest(array['leader', 'technical', 'material', 'warehouse', 'accounting', 'intake', 'sales']) r where (select private.in_department(r));
$$;

-- Người theo chức danh (thứ tự đã đặt)
create or replace function private.role_people(p_role text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x order by o), '{}') from jsonb_array_elements_text(coalesce(
    (select departments -> (case when p_role = 'material' and jsonb_array_length(coalesce(departments -> 'material', '[]'::jsonb)) = 0 then 'warehouse' else p_role end)
     from public.procurement_settings where id = 1), '[]'::jsonb)) with ordinality t(x, o);
$$;

-- Người trong khối: mã hồ sơ, hoặc "role:<chức danh>" → người đang giữ chức danh; bỏ trùng, giữ thứ tự
create or replace function private.ordered_people(p jsonb)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select x, min(o) as o from (
      select coalesce(r.person, q.x) as x, q.o * 1000 + coalesce(r.ord, 0) as o
      from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) with ordinality q(x, o)
      left join lateral (select person, ord from unnest(private.role_people(substr(q.x, 6))) with ordinality u(person, ord) where q.x like 'role:%') r on true
      where q.x <> '' and not (q.x like 'role:%' and r.person is null)
    ) e group by x
  ) d;
$$;

-- Cây dùng khi gửi phiếu: cây riêng của dự án (mục → nhóm), không có thì cây mặc định của công ty (mục → nhóm)
create or replace function private.project_tree_for(p_project uuid, p_type text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.blocks from public.project_approval_trees t where t.project_id = p_project and t.doc_type = p_type),
    (select t.blocks from public.project_approval_trees t where t.project_id = p_project and t.doc_type = private.tree_doc_type(p_type)),
    (select nullif(s.trees -> p_type, '[]'::jsonb) from public.procurement_settings s where s.id = 1),
    (select nullif(s.trees -> private.tree_doc_type(p_type), '[]'::jsonb) from public.procurement_settings s where s.id = 1));
$$;
revoke all on function private.project_tree_for(uuid, text) from public, anon, authenticated;

-- Giám đốc, Kế toán, Duyệt đầu vào và mọi chức danh thấy mọi dự án (mặc định có trong dự án)
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
    or (select private.in_any_department())
    or (select private.is_project_approver(pid))
    or exists (
      select 1 from public.project_members m
      where m.project_id = pid and m.role <> 'worker' and m.employee_id = (select private.my_employee_id())
    );
$$;

-- Người có tên trong cây của dự án hoặc cây mặc định của công ty: xem được dự án để ký
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
               where t.project_id = pid and p.id = (select private.my_employee_id()))
    or exists (select 1 from public.procurement_settings s, jsonb_each(s.trees) t(k, v), jsonb_array_elements(t.v) b, jsonb_array_elements_text(coalesce(b -> 'people', '[]'::jsonb)) p(id)
               where s.id = 1 and p.id = (select private.my_employee_id())));
$$;

-- Kế toán chi khoản đã duyệt
create or replace function private.is_purchase_payer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.has_access('purchases.pay')) or (select private.in_department('accounting'));
$$;

-- Người duyệt đầu vào: được Nhận hàng, Nhập kho (kiểm tra chất lượng hàng về)
create or replace function private.can_do_stage(p_stage text, p_order uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders;
  dep text := private.stage_department(p_stage);
begin
  select * into o from public.purchase_orders where id = p_order;
  if not found then return false; end if;
  if (select private.is_admin()) or (select private.is_director()) then return true; end if;
  if p_stage in ('received', 'stocked') and (select private.in_department('intake')) then return true; end if;
  if dep = 'pic' then
    return o.requester_id = auth.uid() or (o.project_id is not null and ((select private.is_project_lead(o.project_id)) or (select private.holds_step_strict('pic', o.project_id, null))));
  end if;
  if dep in ('technical', 'material', 'warehouse', 'accounting', 'leader', 'intake', 'sales') then
    return (select private.in_department(dep)) or (o.project_id is not null and (select private.holds_step_strict(dep, o.project_id, null)));
  end if;
  return false;
end;
$$;

-- Lưu cây mặc định của công ty cho một loại phiếu (mảng rỗng = bỏ, dùng quy trình chung)
create or replace function public.company_approval_tree_save(p_doc_type text, p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare clean jsonb;
begin
  if not ((select private.is_admin()) or (select private.is_director())) then raise exception 'FORBIDDEN'; end if;
  if p_doc_type not in ('contract', 'budget', 'explanatory', 'material', 'purchase', 'payment') or jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then raise exception 'BAD_INPUT'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(btrim(coalesce(b ->> 'name', '')), 80),
      'mode', case when b ->> 'mode' = 'sequence' then 'sequence' else 'any' end,
      'people', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements_text(coalesce(b -> 'people', '[]'::jsonb)) with ordinality q(x, o)
        where x like 'role:%' or exists (select 1 from public.employees e where e.id::text = x)), '[]'::jsonb)) order by i), '[]'::jsonb)
  into clean from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality t(b, i);
  update public.procurement_settings set trees = case when jsonb_array_length(clean) = 0 then trees - p_doc_type else jsonb_set(trees, array[p_doc_type], clean) end, updated_at = now() where id = 1;
  perform private.log_event('approval.company_tree', 'procurement_settings', '1', jsonb_build_object('docType', p_doc_type, 'blocks', clean));
end;
$$;

-- Cây mặc định của công ty và người giữ chức danh (cho trang cấu hình, tên hiển thị)
create or replace function public.company_approval_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('trees', s.trees, 'departments', s.departments,
    'names', coalesce((select jsonb_object_agg(e.id::text, coalesce(e.doc ->> 'name', e.code)) from public.employees e
      where e.id::text in (select jsonb_array_elements_text(v) from jsonb_each(s.departments) d(k, v) where jsonb_typeof(v) = 'array')
        or e.id::text in (select jsonb_array_elements_text(b -> 'people') from jsonb_each(s.trees) t(k, v), jsonb_array_elements(v) b)), '{}'::jsonb))
  from public.procurement_settings s where s.id = 1;
$$;

revoke all on function private.role_people(text), private.ordered_people(jsonb) from public, anon;
grant execute on function private.role_people(text), private.ordered_people(jsonb) to authenticated;
revoke all on function public.company_approval_tree_save(text, jsonb), public.company_approval_settings() from public, anon;
grant execute on function public.company_approval_tree_save(text, jsonb), public.company_approval_settings() to authenticated;
