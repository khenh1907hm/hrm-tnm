-- Kho Skill AI (/skills): bài mô tả skill (chữ + ảnh) kèm gói .zip.
-- Ai cũng xem và tải được (kể cả chưa đăng nhập); chỉ admin đăng, sửa, xóa.
-- Tệp nằm trong bucket công khai `skill-files`:
--   zips/<postId>/<tên-file>.zip   gói skill
--   images/<uuid>.<đuôi>           ảnh chèn trong bài

create table public.skill_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  body_html text not null default '' check (char_length(body_html) <= 200000),
  zip_path text,
  zip_name text,
  zip_size bigint,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.skill_posts is 'Kho Skill AI: bài mô tả và gói .zip. Đọc công khai, chỉ admin ghi.';

create index skill_posts_created_at_idx on public.skill_posts (created_at desc);
create index skill_posts_created_by_idx on public.skill_posts (created_by);

alter table public.skill_posts enable row level security;

create policy "skill_posts: ai cũng xem" on public.skill_posts for select to anon, authenticated using (true);
create policy "skill_posts: admin thêm" on public.skill_posts for insert to authenticated with check ((select private.app_role()) = 'admin');
create policy "skill_posts: admin sửa" on public.skill_posts for update to authenticated using ((select private.app_role()) = 'admin') with check ((select private.app_role()) = 'admin');
create policy "skill_posts: admin xóa" on public.skill_posts for delete to authenticated using ((select private.app_role()) = 'admin');

-- Bucket công khai: tải qua URL công khai, không cần policy select (không cho liệt kê tệp).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skill-files', 'skill-files', true, 52428800,
  array['application/zip', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

create policy "skill-files: admin thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'skill-files' and (select private.app_role()) = 'admin');
create policy "skill-files: admin sửa" on storage.objects for update to authenticated
  using (bucket_id = 'skill-files' and (select private.app_role()) = 'admin')
  with check (bucket_id = 'skill-files' and (select private.app_role()) = 'admin');
create policy "skill-files: admin xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'skill-files' and (select private.app_role()) = 'admin');
