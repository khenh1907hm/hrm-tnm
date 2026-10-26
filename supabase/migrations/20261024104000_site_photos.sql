-- Công cụ "Ảnh Trước / Sau công trình" (trang Công cụ → /before-after.html).
-- photo_sites: công trình; photo_items: hạng mục, mỗi hạng mục một cặp ảnh Trước / Sau.
-- Ảnh nằm trong bucket riêng tư `site-photos`, đường dẫn <site_id>/<item_id>/<before|after>-<thời điểm>.jpg.
-- Quyền: admin, hr, employee (nhân viên hiện trường) đều xem / thêm / sửa; tài khoản pending bị chặn.
-- Không xóa cứng: ẩn bằng deleted_at (không có policy delete). Chụp lại = file mới, file cũ giữ nguyên.

create table public.photo_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  address text not null default '' check (char_length(address) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.photo_sites is 'Công trình của công cụ ảnh Trước / Sau. Ẩn bằng deleted_at, không xóa dòng.';

create table public.photo_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.photo_sites (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  note text not null default '' check (char_length(note) <= 1000),
  sort_order integer not null default 0,
  before_path text check (char_length(before_path) <= 300),
  before_width integer check (before_width > 0),
  before_height integer check (before_height > 0),
  before_taken_at timestamptz,
  before_lat double precision check (before_lat between -90 and 90),
  before_lng double precision check (before_lng between -180 and 180),
  after_path text check (char_length(after_path) <= 300),
  after_width integer check (after_width > 0),
  after_height integer check (after_height > 0),
  after_taken_at timestamptz,
  after_lat double precision check (after_lat between -90 and 90),
  after_lng double precision check (after_lng between -180 and 180),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint photo_items_after_needs_before check (after_path is null or before_path is not null)
);
comment on table public.photo_items is 'Hạng mục công trình: một cặp ảnh Trước / Sau và ghi chú địa chỉ. Ẩn bằng deleted_at.';

create index photo_items_site_id_idx on public.photo_items (site_id, sort_order) where deleted_at is null;
create index photo_items_site_fk_idx on public.photo_items (site_id);
create index photo_items_created_by_idx on public.photo_items (created_by);
create index photo_sites_created_by_idx on public.photo_sites (created_by);

create trigger photo_sites_touch before update on public.photo_sites for each row execute function public.touch_updated_at();
create trigger photo_items_touch before update on public.photo_items for each row execute function public.touch_updated_at();

alter table public.photo_sites enable row level security;
alter table public.photo_items enable row level security;

create policy "photo_sites: đọc" on public.photo_sites for select to authenticated
  using ((select private.app_role()) in ('admin', 'hr', 'employee'));
create policy "photo_sites: thêm" on public.photo_sites for insert to authenticated
  with check ((select private.app_role()) in ('admin', 'hr', 'employee'));
create policy "photo_sites: sửa" on public.photo_sites for update to authenticated
  using ((select private.app_role()) in ('admin', 'hr', 'employee'))
  with check ((select private.app_role()) in ('admin', 'hr', 'employee'));

create policy "photo_items: đọc" on public.photo_items for select to authenticated
  using ((select private.app_role()) in ('admin', 'hr', 'employee'));
create policy "photo_items: thêm" on public.photo_items for insert to authenticated
  with check ((select private.app_role()) in ('admin', 'hr', 'employee'));
create policy "photo_items: sửa" on public.photo_items for update to authenticated
  using ((select private.app_role()) in ('admin', 'hr', 'employee'))
  with check ((select private.app_role()) in ('admin', 'hr', 'employee'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "site-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'site-photos' and (select private.app_role()) in ('admin', 'hr', 'employee'));
create policy "site-photos: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-photos' and (select private.app_role()) in ('admin', 'hr', 'employee'));
