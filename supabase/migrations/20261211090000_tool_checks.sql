-- Kiểm tra dụng cụ, máy điện (mẫu "TOOL & MACHINE CHECK PHOTO REPORT", sheet Electrical tool & machine).
--  * Loại dụng cụ (dùng chung toàn công ty): người quản lý đặt trước mỗi loại cần chụp những mục nào.
--    Mục "Out look check" luôn có; 3 mục còn lại tùy loại: earthing (tiếp địa <0.3Ω), resistance (cách điện ≥2MΩ @500V), function (chạy thử).
--  * Mẫu của dự án: danh sách dụng cụ (Serial/Code, nhà thầu, loại) để ngày sau dùng lại, tránh sót.
--  * Phiếu kiểm tra: mỗi dự án mỗi ngày một phiếu, từng dòng có ảnh cho từng mục và Kết quả OK / NG (mặc định OK).
--  * Ảnh ở bucket riêng tư tool-check-photos, đường dẫn <project_id>/<auth uid>/<tên>.jpg.

create table public.tool_check_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  items text[] not null default '{}' check (items <@ array['earthing', 'resistance', 'function']::text[]),
  position integer not null default 0,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tool_check_types is 'Loại dụng cụ kiểm tra: ngoài Out look check (luôn có) thì cần chụp thêm mục nào.';
create unique index tool_check_types_name_idx on public.tool_check_types (lower(trim(name)));
create trigger tool_check_types_touch before update on public.tool_check_types for each row execute function public.touch_updated_at();

insert into public.tool_check_types (name, items, position) values
  ('Máy điện có dây (220/380V)', array['earthing', 'resistance', 'function'], 1),
  ('Dụng cụ dùng pin', array['function'], 2),
  ('Dây nguồn, box chia điện', array['earthing', 'resistance'], 3),
  ('Khác (chỉ kiểm tra bên ngoài)', array[]::text[], 4);

create table public.tool_check_templates (
  project_id uuid primary key references public.projects (id) on delete cascade,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and pg_column_size(rows) < 200000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
comment on table public.tool_check_templates is 'Danh sách dụng cụ mẫu của dự án (serial, subcon, typeId) để ngày sau kiểm tra theo.';
create trigger tool_check_templates_touch before update on public.tool_check_templates for each row execute function public.touch_updated_at();

create table public.tool_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  check_date date not null,
  checked_by text not null default '',
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and pg_column_size(rows) < 500000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, check_date)
);
comment on table public.tool_checks is 'Phiếu kiểm tra dụng cụ theo ngày: rows = [{serial, subcon, typeId, typeName, items, photos{outlook,earthing,resistance,function}, result OK|NG, note}].';
create index tool_checks_project_idx on public.tool_checks (project_id, check_date desc);
create trigger tool_checks_touch before update on public.tool_checks for each row execute function public.touch_updated_at();

-- Ai được đặt loại dụng cụ: quyền quản lý dự án hoặc Admin.
create or replace function public.tool_check_can_manage()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.can_manage_projects()) or (select private.is_admin());
$$;

-- Dự án đang thi công mà người đăng nhập được kiểm tra dụng cụ (người xem được dự án, trừ công nhân).
create or replace function public.my_tool_check_projects()
returns table (project_id uuid, code text, name text, site text, has_template boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.name, coalesce(p.site, ''), exists (select 1 from public.tool_check_templates t where t.project_id = p.id and jsonb_array_length(t.rows) > 0)
  from public.projects p
  where p.status = 'active' and (select private.can_view_project(p.id))
  order by p.code;
$$;

revoke all on function public.tool_check_can_manage(), public.my_tool_check_projects() from public, anon;
grant execute on function public.tool_check_can_manage(), public.my_tool_check_projects() to authenticated;

alter table public.tool_check_types enable row level security;
create policy "tool_check_types: đọc" on public.tool_check_types for select to authenticated using (true);
create policy "tool_check_types: thêm" on public.tool_check_types for insert to authenticated with check ((select public.tool_check_can_manage()));
create policy "tool_check_types: sửa" on public.tool_check_types for update to authenticated using ((select public.tool_check_can_manage())) with check ((select public.tool_check_can_manage()));
create policy "tool_check_types: xóa" on public.tool_check_types for delete to authenticated using ((select public.tool_check_can_manage()));

alter table public.tool_check_templates enable row level security;
create policy "tool_check_templates: đọc" on public.tool_check_templates for select to authenticated using ((select private.can_view_project(project_id)));
create policy "tool_check_templates: thêm" on public.tool_check_templates for insert to authenticated with check ((select private.can_view_project(project_id)));
create policy "tool_check_templates: sửa" on public.tool_check_templates for update to authenticated using ((select private.can_view_project(project_id))) with check ((select private.can_view_project(project_id)));
create policy "tool_check_templates: xóa" on public.tool_check_templates for delete to authenticated using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));

alter table public.tool_checks enable row level security;
create policy "tool_checks: đọc" on public.tool_checks for select to authenticated using ((select private.can_view_project(project_id)));
create policy "tool_checks: thêm" on public.tool_checks for insert to authenticated with check ((select private.can_view_project(project_id)));
create policy "tool_checks: sửa" on public.tool_checks for update to authenticated using ((select private.can_view_project(project_id))) with check ((select private.can_view_project(project_id)));
create policy "tool_checks: xóa" on public.tool_checks for delete to authenticated using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));

grant select, insert, update, delete on public.tool_check_types, public.tool_check_templates, public.tool_checks to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tool-check-photos', 'tool-check-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "tool-check-photos: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-check-photos' and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and (select private.can_view_project(p.id))));
create policy "tool-check-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'tool-check-photos'
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[1] and (select private.can_view_project(p.id))));
create policy "tool-check-photos: xóa ảnh của mình" on storage.objects for delete to authenticated
  using (bucket_id = 'tool-check-photos' and (storage.foldername(name))[2] = (select auth.uid())::text);
