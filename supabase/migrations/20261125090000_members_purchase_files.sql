-- Thành viên không cần vai trò, Giám đốc luôn ở khung Lãnh đạo, tệp đính kèm đơn hàng.
--  * project_members.role thêm 'member' (Thành viên): người tham gia dự án (vd phòng Kế toán), xem được dự án, không có quyền theo vai trò.
--  * director_people(): Giám đốc (để hiện cố định ở khung Lãnh đạo của mọi dự án).
--  * purchase_attachments + bucket riêng tư purchase-files (đường dẫn <id đơn>/<tệp>): 4 loại tệp của đơn hàng.
--    Đơn dự án gửi duyệt phải có "Báo giá có ký xác nhận hoặc PO/Hợp đồng" và nhà cung cấp.

alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check
  check (role in ('pm', 'commander', 'supervisor', 'engineer', 'leader', 'worker', 'member'));

create or replace function public.director_people()
returns table (employee_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.employee_id, coalesce(nullif(p.full_name, ''), e.doc ->> 'name', e.code)
  from public.profiles p left join public.employees e on e.id = p.employee_id
  where p.is_director and p.employee_id is not null;
$$;
revoke all on function public.director_people() from public, anon;
grant execute on function public.director_people() to authenticated;

-- ───────────────────────── Tệp đính kèm đơn hàng ─────────────────────────
create table if not exists public.purchase_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id) on delete cascade,
  kind text not null check (kind in ('signed_quote', 'tnm_quote', 'master_schedule', 'drawing')),
  path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists purchase_attachments_order_idx on public.purchase_attachments (order_id);
comment on table public.purchase_attachments is 'Tệp của đơn hàng: báo giá có ký / PO / HĐ (bắt buộc với đơn dự án), báo giá TNM có ký đóng dấu, tiến độ tổng, bản vẽ.';
alter table public.purchase_attachments enable row level security;

drop policy if exists "purchase_attachments: đọc" on public.purchase_attachments;
create policy "purchase_attachments: đọc" on public.purchase_attachments for select to authenticated using ((select private.can_view_purchase(order_id)));
drop policy if exists "purchase_attachments: thêm" on public.purchase_attachments;
create policy "purchase_attachments: thêm" on public.purchase_attachments for insert to authenticated
  with check ((select private.can_view_purchase(order_id)) and uploaded_by = (select auth.uid()));
drop policy if exists "purchase_attachments: xóa" on public.purchase_attachments;
create policy "purchase_attachments: xóa" on public.purchase_attachments for delete to authenticated
  using ((select private.can_view_purchase(order_id)) and (uploaded_by = (select auth.uid()) or (select private.is_admin())));

insert into storage.buckets (id, name, public, file_size_limit) values ('purchase-files', 'purchase-files', false, 26214400)
on conflict (id) do nothing;

-- Đường dẫn tệp: <id đơn>/<tên>; quyền theo quyền xem đơn
create or replace function private.purchase_file_order(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function private.purchase_file_order(text) to authenticated;

drop policy if exists "purchase-files: đọc" on storage.objects;
create policy "purchase-files: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'purchase-files' and (select private.can_view_purchase(private.purchase_file_order(name))));
drop policy if exists "purchase-files: thêm" on storage.objects;
create policy "purchase-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-files' and (select private.can_view_purchase(private.purchase_file_order(name))));
drop policy if exists "purchase-files: xóa" on storage.objects;
create policy "purchase-files: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-files' and (select private.can_view_purchase(private.purchase_file_order(name))));

-- Đơn dự án gửi duyệt: bắt buộc nhà cung cấp và báo giá có ký / PO / HĐ.
create or replace function private.purchase_submit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'project' and new.status = 'submitted' and old.status is distinct from 'submitted' then
    if char_length(btrim(coalesce(new.supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
    if not exists (select 1 from public.purchase_attachments a where a.order_id = new.id and a.kind = 'signed_quote') then
      raise exception 'PO_ATTACH_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists purchase_submit_guard on public.purchase_orders;
create trigger purchase_submit_guard before update of status on public.purchase_orders
  for each row execute function private.purchase_submit_guard();
