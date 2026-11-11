-- Sơ đồ tổ chức nhà thầu phụ (mẫu Taikisha BH-02-F02) của từng dự án, nhập trên web thay file Excel.
-- doc: { header: {...}, people: [...] } — ảnh chân dung thu nhỏ nằm ngay trong doc để in không phụ thuộc kho tệp.
-- Đọc: ai xem được dự án. Sửa: PM, Chỉ huy trưởng của dự án, hoặc người có quyền quản lý dự án.

create table public.project_org_charts (
  project_id uuid primary key references public.projects (id) on delete cascade,
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and jsonb_typeof(doc -> 'people') = 'array' and pg_column_size(doc) < 3000000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on table public.project_org_charts is 'Sơ đồ tổ chức nhà thầu phụ (BH-02-F02) của dự án: tiêu đề, khối văn phòng, công trường, quản lý nhóm.';
create trigger project_org_charts_touch before update on public.project_org_charts for each row execute function public.touch_updated_at();

alter table public.project_org_charts enable row level security;
create policy "project_org_charts: đọc" on public.project_org_charts for select to authenticated
  using ((select private.can_view_project(project_id)));
create policy "project_org_charts: thêm" on public.project_org_charts for insert to authenticated
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
create policy "project_org_charts: sửa" on public.project_org_charts for update to authenticated
  using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()))
  with check ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));
create policy "project_org_charts: xóa" on public.project_org_charts for delete to authenticated
  using ((select private.is_project_lead(project_id)) or (select private.can_manage_projects()));

-- Mẫu chung của công ty (một dòng): tiêu đề (nhà thầu, công ty, người ký…) và khối Văn phòng (Giám đốc…).
-- Sơ đồ mới của mọi dự án bắt đầu từ mẫu này. Mọi người đăng nhập đọc được; Admin hoặc quyền quản lý dự án mới sửa.
create table public.org_chart_template (
  id smallint primary key default 1 check (id = 1),
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and jsonb_typeof(doc -> 'people') = 'array' and pg_column_size(doc) < 3000000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on table public.org_chart_template is 'Mẫu chung sơ đồ tổ chức nhà thầu phụ (tiêu đề + khối Văn phòng) cho mọi dự án.';
create trigger org_chart_template_touch before update on public.org_chart_template for each row execute function public.touch_updated_at();
alter table public.org_chart_template enable row level security;
create policy "org_chart_template: đọc" on public.org_chart_template for select to authenticated using (true);
create policy "org_chart_template: thêm" on public.org_chart_template for insert to authenticated with check ((select private.is_admin()) or (select private.can_manage_projects()));
create policy "org_chart_template: sửa" on public.org_chart_template for update to authenticated
  using ((select private.is_admin()) or (select private.can_manage_projects()))
  with check ((select private.is_admin()) or (select private.can_manage_projects()));

-- Mẫu ban đầu: Giám đốc Nguyễn Gia Luân, nhà thầu THIENNHATMINH CO.LTD
insert into public.org_chart_template (id, doc) values (1, jsonb_build_object(
  'header', jsonb_build_object(
    'contractor', 'THIENNHATMINH CO.LTD', 'client', '', 'item', '',
    'companyName', 'CÔNG TY TNHH THIÊN NHẬT MINH', 'companyAddress', '75 Nguyễn Cửu Đàm, P. Tân Sơn Nhì, Tp. Hồ Chí Minh, Việt Nam', 'companyFax', '', 'companyEmail', '',
    'companyPhone', '(028) 3812 6990', 'signDate', '', 'signerTitle', 'Giám đốc', 'signerName', 'NGUYỄN GIA LUÂN',
    'formCode', 'BH-02-F02:2026.0', 'emailDomain', 'thiennhatminh.com', 'showLogos', true),
  'people', jsonb_build_array(jsonb_build_object(
    'id', 'director', 'section', 'office', 'branch', 'main', 'titleEn', 'Director', 'titleVi', 'Giám đốc',
    'name', 'NGUYỄN GIA LUÂN', 'phone', '0983449446', 'email', 'ng.luan@thiennhatminh.com', 'photo', null,
    'workerCount', null, 'color', 'blue', 'employeeId', null))
)) on conflict (id) do nothing;
