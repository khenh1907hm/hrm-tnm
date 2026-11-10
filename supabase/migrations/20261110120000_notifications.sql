-- Thông báo: nơi nhận (hiện là nhóm/người Telegram) và nhật ký đã gửi bản tin.
-- Thiết kế cho nhiều kênh và nhiều loại thông báo: mỗi nơi nhận có kênh (channel), tên, bật/tắt
-- và danh sách loại thông báo đăng ký (doc.topics, hiện chỉ có 'certificate_digest').
-- Token bot KHÔNG lưu ở đây: nằm ở biến môi trường máy chủ TELEGRAM_BOT_TOKEN.
-- Chỉ Admin xem, sửa nơi nhận. Nhật ký chỉ máy chủ (khóa bí mật) ghi; Admin đọc để kiểm tra.
-- Tạo lại theo tên (if not exists / drop if exists) nên chạy lại nhiều lần vẫn ra cùng kết quả.

create table if not exists public.notification_targets (
  id text primary key,
  version integer not null check (version >= 1),
  channel text not null check (channel in ('telegram')),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notification_targets is 'Nơi nhận thông báo (vd nhóm Telegram); doc gồm name, chatId, enabled, topics.';

drop trigger if exists notification_targets_touch on public.notification_targets;
create trigger notification_targets_touch before update on public.notification_targets for each row execute function public.touch_updated_at();

-- Mỗi lần gửi thành công một bản tin tới một nơi nhận ghi một dòng; khóa `topic|ngày|nơi nhận` chống gửi trùng.
create table if not exists public.notification_log (
  identity text primary key,
  topic text not null,
  channel text not null,
  target_id text,
  sent_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists notification_log_sent_on_idx on public.notification_log (sent_on);

alter table public.notification_targets enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists "notification_targets: admin đọc" on public.notification_targets;
create policy "notification_targets: admin đọc" on public.notification_targets for select to authenticated using ((select private.is_admin()));
drop policy if exists "notification_targets: admin thêm" on public.notification_targets;
create policy "notification_targets: admin thêm" on public.notification_targets for insert to authenticated with check ((select private.is_admin()));
drop policy if exists "notification_targets: admin sửa" on public.notification_targets;
create policy "notification_targets: admin sửa" on public.notification_targets for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "notification_targets: admin xóa" on public.notification_targets;
create policy "notification_targets: admin xóa" on public.notification_targets for delete to authenticated using ((select private.is_admin()));

-- Không có policy ghi: chỉ lịch chạy ở máy chủ (khóa bí mật, bỏ qua RLS) ghi nhật ký.
drop policy if exists "notification_log: admin đọc" on public.notification_log;
create policy "notification_log: admin đọc" on public.notification_log for select to authenticated using ((select private.is_admin()));
