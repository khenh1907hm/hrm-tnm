-- Báo cáo công trình (QHSE PHOTO REPORT, mẫu "Báo cáo Ban Giám Đốc kiểm tra công trình"):
-- Sếp đi công trường chụp lỗi (khoanh tròn / ô vuông để nhấn mạnh), ghi Vấn đề, Cách giải quyết, Thời gian hoàn thiện mong muốn;
-- phiếu giao mặc định cho trưởng dự án (PM). PM sửa xong chụp ảnh sau (cũng khoanh được), ghi Comment, ngày hoàn thành.

-- Người được lập báo cáo công trình: do Sếp (Giám đốc) hoặc Admin chỉ định.
create table if not exists public.site_inspectors (
  employee_id text primary key,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.site_inspectors enable row level security;

create or replace function private.is_site_inspector()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select private.is_director())
    or exists (select 1 from public.site_inspectors s where s.employee_id = (select private.my_employee_id()));
$$;

create table if not exists public.site_inspections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number text not null,
  check_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete set null,
  reporter_name text not null default '',
  attention_employee_id text,
  attention_name text not null default '',
  cc text not null default '' check (char_length(cc) <= 300),
  status text not null default 'draft' check (status in ('draft', 'open', 'fixed', 'closed')),
  note text not null default '' check (char_length(note) <= 2000),
  submitted_at timestamptz,
  fixed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index if not exists site_inspections_project_idx on public.site_inspections (project_id, check_date desc);
alter table public.site_inspections enable row level security;

create table if not exists public.site_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.site_inspections(id) on delete cascade,
  seq integer not null default 1,
  location text not null default '' check (char_length(location) <= 200),
  found_time text not null default '' check (char_length(found_time) <= 20),
  problem text not null default '' check (char_length(problem) <= 2000),
  countermeasure text not null default '' check (char_length(countermeasure) <= 2000),
  target_date date,
  before_photo text,
  before_marks jsonb not null default '[]'::jsonb,
  after_photo text,
  after_marks jsonb not null default '[]'::jsonb,
  comment text not null default '' check (char_length(comment) <= 2000),
  finish_date date,
  fixed_by_name text not null default '',
  fixed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists site_inspection_items_parent_idx on public.site_inspection_items (inspection_id, seq);
alter table public.site_inspection_items enable row level security;

-- Ai xem được: người lập, Sếp / Admin, người được giao, người trong dự án
create or replace function private.can_view_inspection(iid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.site_inspections i
    where i.id = iid and (
      i.reporter_id = (select auth.uid())
      or (select private.is_director())
      or (i.attention_employee_id is not null and i.attention_employee_id = (select private.my_employee_id()))
      or (i.status <> 'draft' and (select private.is_project_insider(i.project_id)))
      or (i.status <> 'draft' and (select private.is_site_inspector()))
    )
  );
$$;
-- Phần "Trước" (lỗi): người lập hoặc Admin, khi phiếu chưa đóng
create or replace function private.can_edit_inspection(iid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.site_inspections i where i.id = iid and i.status <> 'closed'
    and (i.reporter_id = (select auth.uid()) or (select private.is_admin())));
$$;
-- Phần "Sau" (đã sửa): người được giao, PM / chỉ huy của dự án, Admin, khi phiếu đã gửi và chưa đóng
create or replace function private.can_fix_inspection(iid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.site_inspections i where i.id = iid and i.status in ('open', 'fixed')
    and ((i.attention_employee_id is not null and i.attention_employee_id = (select private.my_employee_id()))
      or (select private.is_project_lead(i.project_id)) or (select private.is_admin())));
$$;

drop policy if exists "site_inspectors: đọc" on public.site_inspectors;
create policy "site_inspectors: đọc" on public.site_inspectors for select to authenticated using (true);
drop policy if exists "site_inspectors: sếp sửa" on public.site_inspectors;
create policy "site_inspectors: sếp sửa" on public.site_inspectors for all to authenticated
  using ((select private.is_director())) with check ((select private.is_director()));

drop policy if exists "site_inspections: đọc" on public.site_inspections;
create policy "site_inspections: đọc" on public.site_inspections for select to authenticated using ((select private.can_view_inspection(id)));
drop policy if exists "site_inspections: thêm" on public.site_inspections;
create policy "site_inspections: thêm" on public.site_inspections for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select private.is_site_inspector()) and status = 'draft');
drop policy if exists "site_inspections: sửa" on public.site_inspections;
create policy "site_inspections: sửa" on public.site_inspections for update to authenticated
  using ((select private.can_edit_inspection(id))) with check (reporter_id is not null);
drop policy if exists "site_inspections: xóa nháp" on public.site_inspections;
create policy "site_inspections: xóa nháp" on public.site_inspections for delete to authenticated
  using (status = 'draft' and (reporter_id = (select auth.uid()) or (select private.is_admin())));

drop policy if exists "site_inspection_items: đọc" on public.site_inspection_items;
create policy "site_inspection_items: đọc" on public.site_inspection_items for select to authenticated using ((select private.can_view_inspection(inspection_id)));
drop policy if exists "site_inspection_items: người lập" on public.site_inspection_items;
create policy "site_inspection_items: người lập" on public.site_inspection_items for all to authenticated
  using ((select private.can_edit_inspection(inspection_id))) with check ((select private.can_edit_inspection(inspection_id)));
drop policy if exists "site_inspection_items: người sửa" on public.site_inspection_items;
create policy "site_inspection_items: người sửa" on public.site_inspection_items for update to authenticated
  using ((select private.can_fix_inspection(inspection_id))) with check ((select private.can_fix_inspection(inspection_id)));

-- Người sửa chỉ được đổi phần "Sau"; phần "Trước" giữ nguyên (trừ người lập / Admin)
create or replace function private.site_inspection_items_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select private.can_edit_inspection(new.inspection_id)) then return new; end if;
  new.seq := old.seq; new.location := old.location; new.found_time := old.found_time; new.problem := old.problem;
  new.countermeasure := old.countermeasure; new.target_date := old.target_date; new.before_photo := old.before_photo; new.before_marks := old.before_marks;
  return new;
end;
$$;
drop trigger if exists site_inspection_items_guard on public.site_inspection_items;
create trigger site_inspection_items_guard before update on public.site_inspection_items for each row execute function private.site_inspection_items_guard();

-- Dự án để chọn khi lập báo cáo: người lập báo cáo thấy mọi dự án đang chạy, kèm trưởng dự án (PM)
create or replace function public.site_inspection_projects()
returns table (project_id uuid, code text, name text, site text, status text, pm_employee_id text, pm_name text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.name, coalesce(p.site, ''), p.status::text, p.pm_employee_id, coalesce(e.doc ->> 'name', '')
  from public.projects p left join public.employees e on e.id::text = p.pm_employee_id
  where p.status in ('active', 'paused') and ((select private.is_site_inspector()) or (select private.can_view_project(p.id)))
  order by p.code;
$$;

create or replace function public.site_inspection_can_create()
returns boolean language sql stable security definer set search_path = '' as $$ select (select private.is_site_inspector()); $$;

-- Danh sách người lập báo cáo (Sếp / Admin chỉnh)
create or replace function public.site_inspectors_list()
returns table (employee_id text, code text, name text)
language sql stable security definer set search_path = ''
as $$
  select s.employee_id, coalesce(e.code, ''), coalesce(e.doc ->> 'name', '') from public.site_inspectors s left join public.employees e on e.id::text = s.employee_id order by 3;
$$;

-- Số phiếu QHSE-<mã dự án>-<3 số>
create or replace function private.site_inspection_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare code text; seq integer;
begin
  if new.number is null or new.number = '' then
    select p.code into code from public.projects p where p.id = new.project_id;
    select count(*) + 1 into seq from public.site_inspections i where i.project_id = new.project_id;
    loop
      new.number := format('QHSE-%s-%s', coalesce(code, 'DA'), lpad(seq::text, 3, '0'));
      exit when not exists (select 1 from public.site_inspections i where i.project_id = new.project_id and i.number = new.number);
      seq := seq + 1;
    end loop;
  end if;
  if new.reporter_name = '' then
    select coalesce(nullif(p.full_name, ''), u.email, '') into new.reporter_name from public.profiles p left join auth.users u on u.id = p.id where p.id = new.reporter_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists site_inspection_number on public.site_inspections;
create trigger site_inspection_number before insert or update on public.site_inspections for each row execute function private.site_inspection_number();

-- Thông báo: gửi phiếu → người được giao; báo đã sửa xong → người lập
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check check (kind = any (array[
  'approval_pending', 'approval_returned', 'approval_approved', 'bug_report', 'delivery_due', 'inspection_assigned', 'inspection_fixed', 'inspection_closed'
]));

create or replace function public.site_inspection_submit(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare rec public.site_inspections; target uuid; pname text;
begin
  select * into rec from public.site_inspections where id = p_id;
  if rec.id is null or not (rec.reporter_id = auth.uid() or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  if rec.status not in ('draft', 'open') then raise exception 'INSPECTION_NOT_DRAFT'; end if;
  if not exists (select 1 from public.site_inspection_items where inspection_id = p_id) then raise exception 'INSPECTION_NO_ITEMS'; end if;
  if rec.attention_employee_id is null then raise exception 'INSPECTION_NO_ASSIGNEE'; end if;
  update public.site_inspections set status = 'open', submitted_at = coalesce(submitted_at, now()) where id = p_id;
  select p.id into target from public.profiles p where p.employee_id = rec.attention_employee_id limit 1;
  select name into pname from public.projects where id = rec.project_id;
  if target is not null then
    insert into public.user_notifications (user_id, kind, doc_type, doc_id, project_id, title, body, link)
    values (target, 'inspection_assigned', 'inspection', p_id, rec.project_id,
      format('Báo cáo công trình %s cần khắc phục', rec.number),
      format('%s · %s lỗi · %s kiểm tra ngày %s. Sửa xong chụp ảnh sau, ghi comment.', coalesce(pname, ''), (select count(*) from public.site_inspection_items where inspection_id = p_id), rec.reporter_name, to_char(rec.check_date, 'DD/MM/YYYY')),
      format('/bao-cao-hang-thang?phieu=%s', p_id));
  end if;
end;
$$;

create or replace function public.site_inspection_mark_fixed(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare rec public.site_inspections; pname text;
begin
  select * into rec from public.site_inspections where id = p_id;
  if rec.id is null or not (select private.can_fix_inspection(p_id)) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from public.site_inspection_items where inspection_id = p_id and (after_photo is null or finish_date is null)) then raise exception 'INSPECTION_ITEMS_NOT_FIXED'; end if;
  update public.site_inspections set status = 'fixed', fixed_at = now() where id = p_id;
  select name into pname from public.projects where id = rec.project_id;
  insert into public.user_notifications (user_id, kind, doc_type, doc_id, project_id, title, body, link)
  values (rec.reporter_id, 'inspection_fixed', 'inspection', p_id, rec.project_id,
    format('Đã khắc phục báo cáo công trình %s', rec.number),
    format('%s · %s đã sửa xong, có ảnh sau. Kiểm tra rồi đóng phiếu.', coalesce(pname, ''), coalesce(nullif(rec.attention_name, ''), 'Trưởng dự án')),
    format('/bao-cao-hang-thang?phieu=%s', p_id));
end;
$$;

create or replace function public.site_inspection_close(p_id uuid, p_reopen boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare rec public.site_inspections; target uuid;
begin
  select * into rec from public.site_inspections where id = p_id;
  if rec.id is null or not (rec.reporter_id = auth.uid() or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  if p_reopen then
    update public.site_inspections set status = 'open', fixed_at = null, closed_at = null where id = p_id;
    select p.id into target from public.profiles p where p.employee_id = rec.attention_employee_id limit 1;
    if target is not null then
      insert into public.user_notifications (user_id, kind, doc_type, doc_id, project_id, title, body, link)
      values (target, 'inspection_assigned', 'inspection', p_id, rec.project_id, format('Báo cáo công trình %s cần sửa lại', rec.number), 'Người kiểm tra chưa đồng ý kết quả khắc phục, xem lại các lỗi.', format('/bao-cao-hang-thang?phieu=%s', p_id));
    end if;
  else
    update public.site_inspections set status = 'closed', closed_at = now() where id = p_id;
  end if;
end;
$$;

revoke all on function private.is_site_inspector(), private.can_view_inspection(uuid), private.can_edit_inspection(uuid), private.can_fix_inspection(uuid) from public, anon;
grant execute on function private.is_site_inspector(), private.can_view_inspection(uuid), private.can_edit_inspection(uuid), private.can_fix_inspection(uuid) to authenticated;
revoke all on function public.site_inspection_projects(), public.site_inspection_can_create(), public.site_inspectors_list(), public.site_inspection_submit(uuid), public.site_inspection_mark_fixed(uuid), public.site_inspection_close(uuid, boolean) from public, anon;
grant execute on function public.site_inspection_projects(), public.site_inspection_can_create(), public.site_inspectors_list(), public.site_inspection_submit(uuid), public.site_inspection_mark_fixed(uuid), public.site_inspection_close(uuid, boolean) to authenticated;
grant select, insert, update, delete on public.site_inspections, public.site_inspection_items, public.site_inspectors to authenticated;

-- Ảnh: <id phiếu>/<id người tải>/<tên>.jpg; xem theo quyền xem phiếu, tải lên khi được sửa phần trước hoặc phần sau
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-inspection-photos', 'site-inspection-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "site-inspection-photos: đọc" on storage.objects;
create policy "site-inspection-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'site-inspection-photos' and (select private.can_view_inspection(((storage.foldername(name))[1])::uuid)));
drop policy if exists "site-inspection-photos: thêm" on storage.objects;
create policy "site-inspection-photos: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-inspection-photos' and (storage.foldername(name))[2] = (select auth.uid())::text
    and ((select private.can_edit_inspection(((storage.foldername(name))[1])::uuid)) or (select private.can_fix_inspection(((storage.foldername(name))[1])::uuid))));
drop policy if exists "site-inspection-photos: xóa ảnh của mình" on storage.objects;
create policy "site-inspection-photos: xóa ảnh của mình" on storage.objects for delete to authenticated
  using (bucket_id = 'site-inspection-photos' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- Danh mục thiết bị có sẵn cho Báo cáo thiết bị (chọn từ danh sách; thêm cái cùng loại tự đánh số 1, 2, 3…)
create table if not exists public.tool_check_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  type_id uuid references public.tool_check_types(id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.tool_check_catalog enable row level security;
drop policy if exists "tool_check_catalog: đọc" on public.tool_check_catalog;
create policy "tool_check_catalog: đọc" on public.tool_check_catalog for select to authenticated using (true);
drop policy if exists "tool_check_catalog: quản lý" on public.tool_check_catalog;
create policy "tool_check_catalog: quản lý" on public.tool_check_catalog for all to authenticated
  using ((select public.tool_check_can_manage())) with check ((select public.tool_check_can_manage()));
grant select, insert, update, delete on public.tool_check_catalog to authenticated;

insert into public.tool_check_catalog (name, type_id, position)
select item.name, (select t.id from public.tool_check_types t where t.name = item.type_name limit 1), item.position
from (values
  ('Máy khoan điện', 'Máy điện có dây (220/380V)', 1), ('Máy khoan bê tông', 'Máy điện có dây (220/380V)', 2), ('Máy đục bê tông', 'Máy điện có dây (220/380V)', 3),
  ('Máy cắt cầm tay', 'Máy điện có dây (220/380V)', 4), ('Máy mài cầm tay', 'Máy điện có dây (220/380V)', 5), ('Máy cắt sắt bàn', 'Máy điện có dây (220/380V)', 6),
  ('Máy hàn điện', 'Máy điện có dây (220/380V)', 7), ('Máy bắn vít có dây', 'Máy điện có dây (220/380V)', 8), ('Máy ren ống', 'Máy điện có dây (220/380V)', 9),
  ('Máy uốn ống', 'Máy điện có dây (220/380V)', 10), ('Máy thổi bụi', 'Máy điện có dây (220/380V)', 11), ('Máy hút bụi', 'Máy điện có dây (220/380V)', 12),
  ('Máy khoan pin', 'Dụng cụ dùng pin', 20), ('Máy bắn vít pin', 'Dụng cụ dùng pin', 21), ('Máy mài pin', 'Dụng cụ dùng pin', 22), ('Máy cắt pin', 'Dụng cụ dùng pin', 23),
  ('Máy siết bu lông pin', 'Dụng cụ dùng pin', 24), ('Đèn pin công trường', 'Dụng cụ dùng pin', 25),
  ('Dây nguồn (ru lô)', 'Dây nguồn, box chia điện', 30), ('Box chia điện', 'Dây nguồn, box chia điện', 31), ('Ổ cắm kéo dài', 'Dây nguồn, box chia điện', 32), ('Tủ điện tạm', 'Dây nguồn, box chia điện', 33),
  ('Thang chữ A', 'Khác (chỉ kiểm tra bên ngoài)', 40), ('Thang nhôm rút', 'Khác (chỉ kiểm tra bên ngoài)', 41), ('Giàn giáo di động', 'Khác (chỉ kiểm tra bên ngoài)', 42),
  ('Đồng hồ VOM', 'Khác (chỉ kiểm tra bên ngoài)', 43), ('Máy đo cách điện', 'Khác (chỉ kiểm tra bên ngoài)', 44), ('Ampe kìm', 'Khác (chỉ kiểm tra bên ngoài)', 45),
  ('Máy cân mực laser', 'Khác (chỉ kiểm tra bên ngoài)', 46), ('Dây an toàn toàn thân', 'Khác (chỉ kiểm tra bên ngoài)', 47), ('Bộ dụng cụ cầm tay', 'Khác (chỉ kiểm tra bên ngoài)', 48)
) as item(name, type_name, position)
on conflict (name) do nothing;
