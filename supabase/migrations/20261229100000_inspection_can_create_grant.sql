-- Sửa lỗi "permission denied for function can_create_inspection" khi lập báo cáo công trình (policy thêm phiếu gọi hàm này).
grant execute on function private.can_create_inspection(uuid) to authenticated;

-- Tạo phiếu xong app đọc lại id (insert ... returning): hàm can_view_inspection chưa thấy dòng vừa thêm,
-- nên người lập không phải Sếp bị chặn. Cho người lập xem phiếu của mình ngay trên dòng.
drop policy if exists "site_inspections: đọc" on public.site_inspections;
create policy "site_inspections: đọc" on public.site_inspections for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.can_view_inspection(id)));
