-- Công (người × ngày) của dự án trước khi dùng hệ thống: nhập tay để công lũy kế ở báo cáo tuần / tháng chạy đúng thực tế.
-- opening_as_of: số công tính đến hết ngày này; báo cáo ngày sau mốc này được cộng tiếp.
alter table public.projects
  add column if not exists opening_workdays numeric not null default 0 check (opening_workdays >= 0),
  add column if not exists opening_as_of date;
