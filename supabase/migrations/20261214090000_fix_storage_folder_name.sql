-- Sửa quy tắc kho ảnh: trong "exists (select 1 from public.projects p ...)" chữ `name` bị hiểu là p.name (tên dự án)
-- thay vì đường dẫn ảnh → mọi ảnh kiểm tra dụng cụ bị từ chối (app báo "tài khoản chưa liên kết…"), PM không xem được ảnh chấm công.
-- Ghi rõ objects.name.
-- Loại "Dây nguồn, box chia điện": chụp ô 1 (Out look), 2 (Earthing), 4 (Functions test); ô 3 (Resistance) N/A.

drop policy if exists "tool-check-photos: thêm" on storage.objects;
create policy "tool-check-photos: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-check-photos' and (storage.foldername(objects.name))[2] = (select auth.uid())::text
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(objects.name))[1] and (select private.can_view_project(p.id))));

drop policy if exists "tool-check-photos: đọc" on storage.objects;
create policy "tool-check-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'tool-check-photos'
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(objects.name))[1] and (select private.can_view_project(p.id))));

drop policy if exists "attendance-photos: đọc" on storage.objects;
create policy "attendance-photos: đọc" on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and (
    (storage.foldername(objects.name))[2] = (select auth.uid())::text
    or (select private.has_access('projects.view'))
    or exists (select 1 from public.projects p where p.id::text = (storage.foldername(objects.name))[1] and (select private.is_project_lead(p.id)))
    or exists (select 1 from public.project_members m where m.project_id::text = (storage.foldername(objects.name))[1] and (select private.leads_team(m.project_id, m.team)))));

update public.tool_check_types set items = array['earthing', 'function'] where name = 'Dây nguồn, box chia điện';
