-- Dự án: tên, khách hàng, mẫu hồ sơ, danh sách nhân sự tham gia và chỉ huy trưởng công trường.
-- Lưu dạng tài liệu (doc) như các bảng khác; khóa lạc quan qua cột version.
create table public.projects (
  id text primary key,
  version integer not null check (version >= 1),
  name text not null,
  archived_at timestamptz,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_active_idx on public.projects (updated_at desc) where archived_at is null;

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;

-- Admin và HR đều tạo/sửa được dự án; không xóa cứng (chỉ lưu trữ).
create policy "projects: đọc" on public.projects for select to authenticated using ((select private.app_role()) in ('admin', 'hr'));
create policy "projects: thêm" on public.projects for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
create policy "projects: sửa" on public.projects for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));
