-- Confirm Contract (P-COST-01): tệp đính kèm thật, bắt buộc báo giá có ký; dự án chỉ "chạy" khi Confirm Contract được duyệt.
--  * contract_attachments + bucket riêng tư project-files (đường dẫn <id xác nhận>/<tệp>), quyền theo quyền xem ngân sách dự án.
--    Thêm / xóa tệp thì cờ attachments của xác nhận tự cập nhật (để biểu mẫu P-COST-01 đánh dấu ☑).
--  * Gửi ký phải có tệp "Báo giá có ký xác nhận hoặc PO / Hợp đồng".
--  * Lãnh đạo duyệt Confirm Contract: dự án đang "Kế hoạch" chuyển sang "Đang thi công".
--  * project_contract_states(): trạng thái Confirm Contract mới nhất của từng dự án (màu thẻ dự án).

create table if not exists public.contract_attachments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.project_contracts (id) on delete cascade,
  kind text not null check (kind in ('signedQuoteOrPo', 'stampedQuote', 'customerInstruction', 'masterSchedule', 'drawings')),
  path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists contract_attachments_contract_idx on public.contract_attachments (contract_id);
alter table public.contract_attachments enable row level security;

create or replace function private.can_view_contract(p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.project_contracts c where c.id = p_contract and (select private.can_see_budget(c.project_id)));
$$;
grant execute on function private.can_view_contract(uuid) to authenticated;

drop policy if exists "contract_attachments: đọc" on public.contract_attachments;
create policy "contract_attachments: đọc" on public.contract_attachments for select to authenticated using ((select private.can_view_contract(contract_id)));
drop policy if exists "contract_attachments: thêm" on public.contract_attachments;
create policy "contract_attachments: thêm" on public.contract_attachments for insert to authenticated
  with check ((select private.can_view_contract(contract_id)) and uploaded_by = (select auth.uid()));
drop policy if exists "contract_attachments: xóa" on public.contract_attachments;
create policy "contract_attachments: xóa" on public.contract_attachments for delete to authenticated
  using ((select private.can_view_contract(contract_id)) and (uploaded_by = (select auth.uid()) or (select private.is_admin())));

insert into storage.buckets (id, name, public, file_size_limit) values ('project-files', 'project-files', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "project-files: đọc" on storage.objects;
create policy "project-files: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (select private.can_view_contract(private.purchase_file_order(name))));
drop policy if exists "project-files: thêm" on storage.objects;
create policy "project-files: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (select private.can_view_contract(private.purchase_file_order(name))));
drop policy if exists "project-files: xóa" on storage.objects;
create policy "project-files: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (select private.can_view_contract(private.purchase_file_order(name))));

-- Cờ hồ sơ của xác nhận theo tệp thật
create or replace function private.contract_attachment_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := coalesce(new.contract_id, old.contract_id);
  k text := coalesce(new.kind, old.kind);
begin
  update public.project_contracts
  set attachments = coalesce(attachments, '{}'::jsonb) || jsonb_build_object(k, exists (select 1 from public.contract_attachments a where a.contract_id = cid and a.kind = k))
  where id = cid;
  return null;
end;
$$;
drop trigger if exists contract_attachment_flags on public.contract_attachments;
create trigger contract_attachment_flags after insert or delete on public.contract_attachments
  for each row execute function private.contract_attachment_flags();

-- Gửi ký: bắt buộc báo giá có ký / PO / HĐ. Duyệt: dự án chạy.
create or replace function private.contract_status_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted'
     and not exists (select 1 from public.contract_attachments a where a.contract_id = new.id and a.kind = 'signedQuoteOrPo') then
    raise exception 'CONTRACT_ATTACH_REQUIRED';
  end if;
  return new;
end;
$$;
drop trigger if exists contract_status_guard on public.project_contracts;
create trigger contract_status_guard before update of status on public.project_contracts
  for each row execute function private.contract_status_guard();

create or replace function private.contract_approved_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.projects set status = 'active' where id = new.project_id and status = 'planning';
  end if;
  return null;
end;
$$;
drop trigger if exists contract_approved_project on public.project_contracts;
create trigger contract_approved_project after update of status on public.project_contracts
  for each row execute function private.contract_approved_project();

-- Trạng thái Confirm Contract mới nhất của các dự án người xem được (none = chưa lập).
create or replace function public.project_contract_states()
returns table (project_id uuid, status text, revision int)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(c.status, 'none'), coalesce(c.revision, 0)
  from public.projects p
  left join lateral (
    select k.status, k.revision from public.project_contracts k
    where k.project_id = p.id and k.status <> 'superseded'
    order by (k.status = 'approved') desc, k.revision desc limit 1
  ) c on true
  where (select private.can_view_project(p.id));
$$;
revoke all on function public.project_contract_states() from public, anon;
grant execute on function public.project_contract_states() to authenticated;
