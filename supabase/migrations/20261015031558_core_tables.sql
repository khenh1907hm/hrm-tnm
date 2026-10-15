-- TNM HRM — bảng lõi.
-- Mỗi bảng nghiệp vụ lưu nguyên đối tượng trong cột `doc` (JSONB) để khớp lớp repository của app;
-- các cột tách riêng chỉ dùng cho khóa liên kết, chỉ mục và ràng buộc duy nhất.
-- `version` dùng cho khóa lạc quan: app chỉ cập nhật khi version khớp.

-- Hồ sơ người dùng + vai trò
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'hr' check (role in ('admin', 'hr')),
  full_name text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Vai trò người dùng: admin (toàn quyền) hoặc hr (xem, xuất, quản lý mẫu hồ sơ).';

-- Người dùng mới đăng ký luôn nhận vai trò hr; nâng lên admin chỉ bằng SQL/bảng điều khiển.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Vai trò của người đang đăng nhập (dùng trong RLS)
create function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- Tự cập nhật updated_at
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Nhân sự
create table public.employees (
  id text primary key,
  version integer not null check (version >= 1),
  code text not null,
  cccd text not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index employees_code_key on public.employees (lower(code));
create unique index employees_cccd_key on public.employees (cccd);

-- Chỉ huy trưởng (người liên hệ khẩn cấp)
create table public.commanders (
  id text primary key,
  version integer not null check (version >= 1),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Loại chứng chỉ
create table public.certificate_types (
  id text primary key,
  version integer not null check (version >= 1),
  key text not null unique,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chứng chỉ của nhân sự
create table public.certificates (
  id text primary key,
  version integer not null check (version >= 1),
  employee_id text not null references public.employees (id) on delete restrict,
  type text not null,
  state text not null check (state in ('current', 'replaced', 'archived')),
  expiry_date date not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index certificates_employee_id_idx on public.certificates (employee_id);
create index certificates_expiry_idx on public.certificates (expiry_date) where state = 'current';

-- Chữ ký người ký phiếu
create table public.signatures (
  id text primary key,
  version integer not null check (version >= 1),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cài đặt chung (một dòng 'global')
create table public.settings (
  id text primary key default 'global' check (id = 'global'),
  version integer not null default 0 check (version >= 0),
  doc jsonb not null default '{"reminderEmails": [], "sendExpiredNotice": false, "reminderDays": 30}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values ('global');

-- Nhật ký thao tác (chỉ thêm, không sửa/xóa)
create table public.audit_events (
  id text primary key,
  at timestamptz not null,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  doc jsonb not null
);
create index audit_events_at_idx on public.audit_events (at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- Nhắc hạn đã gửi
create table public.reminder_log (
  identity text primary key,
  certificate_id text not null references public.certificates (id) on delete cascade,
  sent_on date not null,
  created_at timestamptz not null default now()
);

-- Mẫu báo cáo / mẫu hồ sơ (file .xlsx lưu ở Storage, đường dẫn trong doc)
create table public.report_templates (
  id text primary key,
  version integer not null default 1 check (version >= 1),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger employees_touch before update on public.employees for each row execute function public.touch_updated_at();
create trigger commanders_touch before update on public.commanders for each row execute function public.touch_updated_at();
create trigger certificate_types_touch before update on public.certificate_types for each row execute function public.touch_updated_at();
create trigger certificates_touch before update on public.certificates for each row execute function public.touch_updated_at();
create trigger signatures_touch before update on public.signatures for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
create trigger report_templates_touch before update on public.report_templates for each row execute function public.touch_updated_at();

-- Bật RLS ngay: chưa có policy nghĩa là chặn toàn bộ truy cập qua API cho tới migration phân quyền.
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.commanders enable row level security;
alter table public.certificate_types enable row level security;
alter table public.certificates enable row level security;
alter table public.signatures enable row level security;
alter table public.settings enable row level security;
alter table public.audit_events enable row level security;
alter table public.reminder_log enable row level security;
alter table public.report_templates enable row level security;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
