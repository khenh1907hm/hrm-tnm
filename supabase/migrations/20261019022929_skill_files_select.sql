-- Sửa lỗi 400 khi admin tải .zip/ảnh lên Kho Skill.
-- Storage chèn tệp bằng INSERT … RETURNING; Postgres bắt dòng vừa chèn phải qua cả policy SELECT,
-- mà bucket `skill-files` chưa có policy SELECT nào → "new row violates row-level security policy".
-- Chỉ cho admin đọc qua API: người xem vẫn tải bằng URL công khai (bucket public, không qua RLS)
-- và vẫn không ai khác liệt kê được danh sách tệp.
create policy "skill-files: admin đọc" on storage.objects for select to authenticated
  using (bucket_id = 'skill-files' and (select private.app_role()) = 'admin');
