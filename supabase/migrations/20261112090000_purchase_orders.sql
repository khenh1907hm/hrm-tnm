-- Đặt hàng (mua hàng) cho dự án và cho văn phòng, có phê duyệt của sếp.
-- Quy trình: Nháp → Lập đơn (chờ duyệt) → Đã duyệt / Bị từ chối → Đặt hàng & theo dõi → Nhận hàng & kiểm tra → Hoàn tất.
-- Thanh toán đi kèm đơn (tạm ứng, thanh toán trước, thanh toán còn lại): Đề nghị → Duyệt (sếp) → Đã chi (người được quyền chi).
--
--  * Người duyệt: danh sách hồ sơ nhân sự trong purchase_settings.approver_employee_ids (mặc định: Nguyễn Gia Luân);
--    tài khoản phải được liên kết hồ sơ (profiles.employee_id). Chỉ người duyệt mới duyệt đơn và duyệt thanh toán.
--  * Người chi tiền: Admin hoặc mục quyền purchases.pay. Xem mọi đơn: Admin, người duyệt, purchases.view, purchases.pay.
--  * Người lập xem đơn của mình; PM, CHT xem đơn của dự án mình.
--  * Mọi bước chuyển trạng thái chỉ qua hàm security definer (có kiểm tra vai trò và trạng thái), ghi nhật ký purchase_events.
--  * Hoàn tất đơn của dự án: tự ghi một phiếu chi vật tư (đã duyệt) bằng tiền thực nhận → trừ vào ngân sách vật tư và vốn dự án.

alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles add constraint profiles_permissions_check check (permissions <@ array[
  'employees.view', 'employees.edit', 'employees.import', 'employees.export', 'employees.archive',
  'certificates.edit', 'certificateTypes.manage', 'reminders.manage',
  'signatures.manage', 'reports.manage', 'tools',
  'projects.view', 'projects.manage',
  'purchases.view', 'purchases.pay'
]::text[]);

create table public.purchase_settings (
  id smallint primary key default 1 check (id = 1),
  approver_employee_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.purchase_settings (id, approver_employee_ids)
values (1, coalesce((select array_agg(e.id) from public.employees e where e.doc ->> 'name' = 'Nguyễn Gia Luân'), '{}'))
on conflict (id) do nothing;
comment on table public.purchase_settings is 'Người phê duyệt đơn hàng (hồ sơ nhân sự). Admin sửa.';

create sequence public.purchase_order_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('project', 'office')),
  project_id uuid references public.projects (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  requester_id uuid not null default auth.uid(),
  requester_name text not null default '',
  department text not null default '',
  needed_by date,
  delivery_address text not null default '',
  supplier text not null default '',
  supplier_contact text not null default '',
  expected_delivery date,
  note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'received', 'completed', 'cancelled')),
  total_estimate bigint not null default 0,
  total_actual bigint,
  approved_by uuid,
  approved_at timestamptz,
  decision_note text not null default '',
  submitted_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  expense_id uuid references public.project_expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'project') = (project_id is not null))
);
create index purchase_orders_project_idx on public.purchase_orders (project_id);
create index purchase_orders_requester_idx on public.purchase_orders (requester_id);
create index purchase_orders_status_idx on public.purchase_orders (status, created_at desc);
create index purchase_orders_expense_idx on public.purchase_orders (expense_id);
comment on table public.purchase_orders is 'Đơn hàng mua cho dự án hoặc văn phòng. Trạng thái chỉ đổi qua các hàm purchase_*.';

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id) on delete cascade,
  sort smallint not null default 0,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  spec text not null default '',
  unit text not null default '',
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_price bigint not null default 0 check (unit_price >= 0),
  received_qty numeric(12, 2) not null default 0 check (received_qty >= 0),
  accepted_qty numeric(12, 2) not null default 0 check (accepted_qty >= 0 and accepted_qty <= received_qty),
  inspection_note text not null default ''
);
create index purchase_items_order_idx on public.purchase_items (order_id, sort);

create table public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id) on delete cascade,
  kind text not null check (kind in ('advance', 'prepayment', 'final')),
  amount bigint not null check (amount > 0),
  payee text not null default '',
  note text not null default '',
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'rejected')),
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  paid_method text not null default '',
  decision_note text not null default ''
);
create index purchase_payments_order_idx on public.purchase_payments (order_id);

create table public.purchase_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text not null default '',
  action text not null,
  note text not null default ''
);
create index purchase_events_order_idx on public.purchase_events (order_id, at);

create trigger purchase_orders_touch before update on public.purchase_orders for each row execute function public.touch_updated_at();

-- ───────────────────────── Hàm quyền ─────────────────────────
create or replace function private.is_purchase_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.my_employee_id()) = any (coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}')), false);
$$;

create or replace function private.is_purchase_payer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin()) or (select private.has_access('purchases.pay'));
$$;

create or replace function private.can_view_purchase(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchase_orders o
    where o.id = oid and (
      o.requester_id = (select auth.uid())
      or (select private.is_admin())
      or (select private.is_purchase_approver())
      or (select private.has_access('purchases.view'))
      or (select private.is_purchase_payer())
      or (o.project_id is not null and (select private.is_project_lead(o.project_id)))
    )
  );
$$;

create or replace function private.can_edit_purchase_draft(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.purchase_orders o where o.id = oid and o.requester_id = (select auth.uid()) and o.status in ('draft', 'rejected'));
$$;

revoke all on function private.is_purchase_approver(), private.is_purchase_payer(), private.can_view_purchase(uuid), private.can_edit_purchase_draft(uuid) from public, anon;
grant execute on function private.is_purchase_approver(), private.is_purchase_payer(), private.can_view_purchase(uuid), private.can_edit_purchase_draft(uuid) to authenticated;

-- Người đang đăng nhập có được đặt hàng không (tài khoản đã cấp quyền); đơn dự án: thành viên (không phải tổ viên) hoặc PM/CHT.
create or replace function private.can_request_purchase(p_kind text, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role in ('admin', 'hr', 'engineer', 'employee') from public.profiles where id = (select auth.uid())), false)
    and (p_kind = 'office' or (select private.can_view_project(p_project)));
$$;
revoke all on function private.can_request_purchase(text, uuid) from public, anon;
grant execute on function private.can_request_purchase(text, uuid) to authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.purchase_settings enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_items enable row level security;
alter table public.purchase_payments enable row level security;
alter table public.purchase_events enable row level security;

create policy "purchase_settings: đọc" on public.purchase_settings for select to authenticated using (true);
create policy "purchase_settings: sửa" on public.purchase_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "purchase_orders: đọc" on public.purchase_orders for select to authenticated using ((select private.can_view_purchase(id)));
create policy "purchase_orders: thêm nháp" on public.purchase_orders for insert to authenticated
  with check (status = 'draft' and requester_id = (select auth.uid()) and (select private.can_request_purchase(kind, project_id)));
create policy "purchase_orders: sửa nháp" on public.purchase_orders for update to authenticated
  using ((select private.can_edit_purchase_draft(id)))
  with check (requester_id = (select auth.uid()) and (select private.can_request_purchase(kind, project_id)));
create policy "purchase_orders: xóa nháp" on public.purchase_orders for delete to authenticated
  using (status = 'draft' and requester_id = (select auth.uid()));

create policy "purchase_items: đọc" on public.purchase_items for select to authenticated using ((select private.can_view_purchase(order_id)));
create policy "purchase_items: ghi nháp" on public.purchase_items for all to authenticated
  using ((select private.can_edit_purchase_draft(order_id))) with check ((select private.can_edit_purchase_draft(order_id)));

create policy "purchase_payments: đọc" on public.purchase_payments for select to authenticated using ((select private.can_view_purchase(order_id)));
create policy "purchase_events: đọc" on public.purchase_events for select to authenticated using ((select private.can_view_purchase(order_id)));

-- Mã đơn DH-YYMM-0001 và chặn đổi trạng thái ngoài các hàm purchase_*
create or replace function private.purchase_order_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.code := 'DH-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad(nextval('public.purchase_order_seq')::text, 4, '0');
    new.requester_name := coalesce(nullif(btrim(new.requester_name), ''), (select full_name from public.profiles where id = new.requester_id), '');
    new.status := 'draft';
  elsif new.status is distinct from old.status and coalesce(current_setting('tnm.purchase_rpc', true), '') <> 'on' then
    raise exception 'PO_STATUS_RPC_ONLY';
  end if;
  return new;
end;
$$;
create trigger purchase_orders_defaults before insert or update on public.purchase_orders for each row execute function private.purchase_order_defaults();

-- ───────────────────────── Hàm nghiệp vụ ─────────────────────────
create or replace function private.purchase_log(p_order uuid, p_action text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.purchase_events (order_id, actor_id, actor_name, action, note)
  values (p_order, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), ''), p_action, coalesce(p_note, ''));
$$;
revoke all on function private.purchase_log(uuid, text, text) from public, anon, authenticated;

create or replace function private.purchase_lock(p_order uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders;
begin
  select * into o from public.purchase_orders where id = p_order for update;
  if not found or not (select private.can_view_purchase(p_order)) then raise exception 'PO_NOT_FOUND'; end if;
  perform set_config('tnm.purchase_rpc', 'on', true);
  return o;
end;
$$;
revoke all on function private.purchase_lock(uuid) from public, anon, authenticated;

-- Lập đơn: gửi người duyệt (đơn nháp hoặc bị từ chối, có ít nhất một món hàng).
create or replace function public.purchase_submit(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.requester_id <> auth.uid() then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('draft', 'rejected') then raise exception 'PO_BAD_STATUS'; end if;
  if not exists (select 1 from public.purchase_items where order_id = p_order) then raise exception 'PO_NO_ITEMS'; end if;
  update public.purchase_orders set status = 'submitted', submitted_at = now(), decision_note = '',
    total_estimate = (select coalesce(sum(round(quantity * unit_price)), 0)::bigint from public.purchase_items where order_id = p_order)
    where id = p_order;
  perform private.purchase_log(p_order, 'submit', '');
end;
$$;

-- Sếp duyệt hoặc từ chối đơn (từ chối cần lý do; người lập sửa rồi lập lại).
create or replace function public.purchase_decide(p_order uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if not (select private.is_purchase_approver()) then raise exception 'PO_NOT_APPROVER'; end if;
  if o.status <> 'submitted' then raise exception 'PO_BAD_STATUS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  update public.purchase_orders set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = case when p_approve then auth.uid() end, approved_at = case when p_approve then now() end, decision_note = btrim(coalesce(p_note, ''))
    where id = p_order;
  perform private.purchase_log(p_order, case when p_approve then 'approve' else 'reject' end, p_note);
end;
$$;

-- Đặt hàng với nhà cung cấp (sau khi duyệt), bắt đầu theo dõi đơn hàng.
create or replace function public.purchase_mark_ordered(p_order uuid, p_supplier text, p_contact text, p_expected date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'approved' then raise exception 'PO_BAD_STATUS'; end if;
  if char_length(btrim(coalesce(p_supplier, ''))) < 2 then raise exception 'PO_SUPPLIER_REQUIRED'; end if;
  update public.purchase_orders set status = 'ordered', ordered_at = now(), supplier = btrim(p_supplier), supplier_contact = btrim(coalesce(p_contact, '')), expected_delivery = p_expected
    where id = p_order;
  perform private.purchase_log(p_order, 'order', concat_ws(' · ', btrim(p_supplier), case when p_expected is not null then 'giao dự kiến ' || to_char(p_expected, 'DD/MM/YYYY') end, nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

-- Ghi tiến độ theo dõi đơn hàng (ai xem được đơn và tham gia xử lý đều ghi được).
create or replace function public.purchase_track(p_order uuid, p_note text, p_expected date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if char_length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'PO_NOTE_REQUIRED'; end if;
  if o.status not in ('approved', 'ordered', 'received') then raise exception 'PO_BAD_STATUS'; end if;
  if p_expected is not null then update public.purchase_orders set expected_delivery = p_expected where id = p_order; end if;
  perform private.purchase_log(p_order, 'track', p_note);
end;
$$;

-- Đề nghị tạm ứng / thanh toán trước / thanh toán còn lại.
create or replace function public.purchase_request_payment(p_order uuid, p_kind text, p_amount bigint, p_payee text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  pid uuid;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_purchase_payer()) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('advance', 'prepayment', 'final') then raise exception 'PO_BAD_PAYMENT'; end if;
  if o.status not in ('approved', 'ordered', 'received') or (p_kind = 'final' and o.status = 'approved') then raise exception 'PO_BAD_STATUS'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'PO_BAD_AMOUNT'; end if;
  insert into public.purchase_payments (order_id, kind, amount, payee, note) values (p_order, p_kind, p_amount, btrim(coalesce(p_payee, '')), btrim(coalesce(p_note, ''))) returning id into pid;
  perform private.purchase_log(p_order, 'payment_request:' || p_kind, p_amount::text || ' đ' || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
  return pid;
end;
$$;

-- Sếp duyệt / từ chối khoản chi.
create or replace function public.purchase_decide_payment(p_payment uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pay public.purchase_payments;
begin
  select * into pay from public.purchase_payments where id = p_payment for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  perform private.purchase_lock(pay.order_id);
  if not (select private.is_purchase_approver()) then raise exception 'PO_NOT_APPROVER'; end if;
  if pay.status <> 'requested' then raise exception 'PO_BAD_STATUS'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  update public.purchase_payments set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(), decision_note = btrim(coalesce(p_note, '')) where id = p_payment;
  perform private.purchase_log(pay.order_id, case when p_approve then 'payment_approve:' else 'payment_reject:' end || pay.kind, pay.amount::text || ' đ' || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
end;
$$;

-- Thực hiện chi (kế toán / người được quyền chi), chỉ khoản đã được sếp duyệt.
create or replace function public.purchase_pay(p_payment uuid, p_method text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pay public.purchase_payments;
begin
  select * into pay from public.purchase_payments where id = p_payment for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  perform private.purchase_lock(pay.order_id);
  if not (select private.is_purchase_payer()) then raise exception 'PO_NOT_PAYER'; end if;
  if pay.status <> 'approved' then raise exception 'PO_PAYMENT_NOT_APPROVED'; end if;
  update public.purchase_payments set status = 'paid', paid_by = auth.uid(), paid_at = now(), paid_method = btrim(coalesce(p_method, '')) where id = p_payment;
  perform private.purchase_log(pay.order_id, 'paid:' || pay.kind, pay.amount::text || ' đ' || coalesce(' · ' || nullif(btrim(p_method), ''), '') || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
end;
$$;

-- Nhận hàng và kiểm tra: số nhận, số đạt, ghi chú từng món. Gọi lại được để cập nhật (nhận nhiều đợt).
create or replace function public.purchase_receive(p_order uuid, p_items jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  item jsonb;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin())
    and not (o.project_id is not null and (select private.is_project_lead(o.project_id))) then raise exception 'FORBIDDEN'; end if;
  if o.status not in ('ordered', 'received') then raise exception 'PO_BAD_STATUS'; end if;
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.purchase_items set
      received_qty = greatest(0, (item ->> 'receivedQty')::numeric),
      accepted_qty = least(greatest(0, (item ->> 'acceptedQty')::numeric), greatest(0, (item ->> 'receivedQty')::numeric)),
      inspection_note = btrim(coalesce(item ->> 'note', ''))
      where id = (item ->> 'id')::uuid and order_id = p_order;
  end loop;
  update public.purchase_orders set status = 'received', received_at = coalesce(received_at, now()),
    total_actual = (select coalesce(sum(round(accepted_qty * unit_price)), 0)::bigint from public.purchase_items where order_id = p_order)
    where id = p_order;
  perform private.purchase_log(p_order, 'receive', p_note);
end;
$$;

-- Hoàn tất: đơn dự án tự ghi phiếu chi vật tư (đã duyệt) bằng tiền thực nhận.
create or replace function public.purchase_complete(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders := private.purchase_lock(p_order);
  eid uuid;
begin
  if o.requester_id <> auth.uid() and not (select private.is_purchase_approver()) and not (select private.is_admin()) then raise exception 'FORBIDDEN'; end if;
  if o.status <> 'received' then raise exception 'PO_BAD_STATUS'; end if;
  if exists (select 1 from public.purchase_payments where order_id = p_order and status in ('requested', 'approved')) then raise exception 'PO_PAYMENTS_PENDING'; end if;
  if o.kind = 'project' and coalesce(o.total_actual, 0) > 0 then
    insert into public.project_expenses (project_id, spent_on, category, description, supplier, amount, status, created_by)
    values (o.project_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'material', left('Đơn hàng ' || o.code || ': ' || o.title, 500), o.supplier, o.total_actual, 'approved', auth.uid())
    returning id into eid;
  end if;
  update public.purchase_orders set status = 'completed', completed_at = now(), expense_id = eid where id = p_order;
  perform private.purchase_log(p_order, 'complete', p_note);
end;
$$;

-- Hủy đơn: người lập khi chưa đặt hàng; sếp hoặc Admin khi chưa hoàn tất. Khoản chi chưa chi bị từ chối theo.
create or replace function public.purchase_cancel(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.purchase_orders := private.purchase_lock(p_order);
begin
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'PO_REASON_REQUIRED'; end if;
  if o.status in ('completed', 'cancelled') then raise exception 'PO_BAD_STATUS'; end if;
  if not ((o.requester_id = auth.uid() and o.status in ('draft', 'submitted', 'rejected', 'approved')) or (select private.is_purchase_approver()) or (select private.is_admin())) then raise exception 'FORBIDDEN'; end if;
  update public.purchase_payments set status = 'rejected', decision_note = 'Đơn bị hủy' where order_id = p_order and status in ('requested', 'approved');
  update public.purchase_orders set status = 'cancelled', decision_note = btrim(p_note) where id = p_order;
  perform private.purchase_log(p_order, 'cancel', p_note);
end;
$$;

-- Tên người duyệt (để hiện trên giao diện; người dùng thường không đọc được bảng employees).
create or replace function public.purchase_approvers()
returns table (employee_id text, name text, has_account boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, coalesce(e.doc ->> 'name', e.code), exists (select 1 from public.profiles p where p.employee_id = e.id)
  from public.employees e
  where e.id = any (coalesce((select approver_employee_ids from public.purchase_settings where id = 1), '{}'));
$$;

-- Vai trò của người đăng nhập với đặt hàng.
create or replace function public.purchase_my_roles()
returns table (is_approver boolean, is_payer boolean, sees_all boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_purchase_approver()), (select private.is_purchase_payer()),
    (select private.is_admin()) or (select private.is_purchase_approver()) or (select private.has_access('purchases.view')) or (select private.is_purchase_payer());
$$;

revoke all on function public.purchase_submit(uuid), public.purchase_decide(uuid, boolean, text), public.purchase_mark_ordered(uuid, text, text, date, text),
  public.purchase_track(uuid, text, date), public.purchase_request_payment(uuid, text, bigint, text, text), public.purchase_decide_payment(uuid, boolean, text),
  public.purchase_pay(uuid, text, text), public.purchase_receive(uuid, jsonb, text), public.purchase_complete(uuid, text), public.purchase_cancel(uuid, text),
  public.purchase_approvers(), public.purchase_my_roles() from public, anon;
grant execute on function public.purchase_submit(uuid), public.purchase_decide(uuid, boolean, text), public.purchase_mark_ordered(uuid, text, text, date, text),
  public.purchase_track(uuid, text, date), public.purchase_request_payment(uuid, text, bigint, text, text), public.purchase_decide_payment(uuid, boolean, text),
  public.purchase_pay(uuid, text, text), public.purchase_receive(uuid, jsonb, text), public.purchase_complete(uuid, text), public.purchase_cancel(uuid, text),
  public.purchase_approvers(), public.purchase_my_roles() to authenticated;

