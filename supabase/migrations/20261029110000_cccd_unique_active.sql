-- CCCD chỉ không trùng giữa các hồ sơ đang hoạt động: người đã nghỉ (hồ sơ lưu trữ) quay lại thì tạo hồ sơ mới được.
-- Mã nhân viên vẫn duy nhất toàn hệ thống, kể cả hồ sơ đã lưu trữ (employees_code_key giữ nguyên).
-- Trạng thái lưu trữ nằm trong doc.archivedAt (null hoặc không có = đang hoạt động).
drop index if exists public.employees_cccd_key;
create unique index if not exists employees_cccd_active_key on public.employees (cccd) where (doc ->> 'archivedAt') is null;
