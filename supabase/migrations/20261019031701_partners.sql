-- Đối tác (khách hàng / chủ đầu tư): tên + ảnh (logo, ảnh dự án).
-- Dùng ở FORM báo cáo để thay nhanh ảnh dự án trong trường ảnh cố định của mẫu hồ sơ.
-- Ảnh lưu dạng data URL PNG/JPG (≤ 2 MB như ảnh cố định của mẫu), để chèn thẳng vào mẫu Excel.
-- Quyền giống report_templates: admin và hr xem, thêm, sửa, xóa; tài khoản khác bị chặn.

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  image text not null default '' check (image = '' or (image ~ '^data:image/(png|jpeg);base64,' and char_length(image) <= 2800000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.partners is 'Đối tác: tên và ảnh (logo/ảnh dự án) dùng khi điền mẫu hồ sơ ở FORM báo cáo.';

create unique index partners_name_key on public.partners (lower(btrim(name)));

create trigger partners_touch_updated_at
  before update on public.partners
  for each row execute function public.touch_updated_at();

alter table public.partners enable row level security;

create policy "partners: đọc" on public.partners for select to authenticated using ((select private.app_role()) in ('admin', 'hr'));
create policy "partners: thêm" on public.partners for insert to authenticated with check ((select private.app_role()) in ('admin', 'hr'));
create policy "partners: sửa" on public.partners for update to authenticated using ((select private.app_role()) in ('admin', 'hr')) with check ((select private.app_role()) in ('admin', 'hr'));
create policy "partners: xóa" on public.partners for delete to authenticated using ((select private.app_role()) in ('admin', 'hr'));
