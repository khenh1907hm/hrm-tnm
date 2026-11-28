-- Thư viện logo nhà thầu / khách hàng (dùng chung cho các mẫu báo cáo: QHSE PHOTO REPORT, sau này các phiếu khác):
-- chọn logo đã lưu hoặc tải logo mới. Báo cáo công trình: logo trái chọn từ thư viện, logo phải (chứng nhận ISO của TNM) bật / tắt.

create table if not exists public.company_logos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  path text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.company_logos enable row level security;
drop policy if exists "company_logos: đọc" on public.company_logos;
create policy "company_logos: đọc" on public.company_logos for select to authenticated using ((select private.is_member()));
drop policy if exists "company_logos: thêm" on public.company_logos;
create policy "company_logos: thêm" on public.company_logos for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));
drop policy if exists "company_logos: sửa, xóa" on public.company_logos;
create policy "company_logos: sửa, xóa" on public.company_logos for update to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin())) with check (true);
drop policy if exists "company_logos: xóa" on public.company_logos;
create policy "company_logos: xóa" on public.company_logos for delete to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));
grant select, insert, update, delete on public.company_logos to authenticated;

-- Ảnh logo: bucket công khai (logo không phải dữ liệu riêng tư), chỉ người đăng nhập tải lên
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "company-logos: tải lên" on storage.objects;
create policy "company-logos: tải lên" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos' and (select private.is_member()));
drop policy if exists "company-logos: xóa" on storage.objects;
create policy "company-logos: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'company-logos' and (owner = (select auth.uid()) or (select private.is_admin())));

alter table public.site_inspections add column if not exists left_logo_id uuid references public.company_logos(id) on delete set null;
alter table public.site_inspections add column if not exists show_cert_logo boolean not null default true;

-- Phiếu mới chưa chọn logo: dùng lại logo trái và bật / tắt logo phải của phiếu gần nhất cùng dự án
create or replace function private.site_inspection_logo_default()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare prev public.site_inspections;
begin
  if new.left_logo_id is null then
    select * into prev from public.site_inspections i where i.project_id = new.project_id order by i.created_at desc limit 1;
    if prev.id is not null then new.left_logo_id := prev.left_logo_id; new.show_cert_logo := prev.show_cert_logo; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists site_inspection_logo_default on public.site_inspections;
create trigger site_inspection_logo_default before insert on public.site_inspections for each row execute function private.site_inspection_logo_default();
