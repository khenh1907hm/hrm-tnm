-- Dọn ảnh base64 còn nằm trong nhật ký cũ (trước khi ảnh chân dung chuyển sang kho tệp hr-files).
-- Nhật ký vẫn chỉ thêm, không sửa (AUD-03); đây là lần dọn dữ liệu một lần, chỉ thay chuỗi ảnh bằng dấu
-- "đã lược bỏ" giống cách app ghi nhật ký mới (AUD-04), mọi trường khác giữ nguyên.
update public.audit_events
set doc = jsonb_set(doc, '{after,photo}', '"data:(đã lược bỏ)"')
where doc->'after'->>'photo' like 'data:%' and doc->'after'->>'photo' <> 'data:(đã lược bỏ)';

update public.audit_events
set doc = jsonb_set(doc, '{before,photo}', '"data:(đã lược bỏ)"')
where doc->'before'->>'photo' like 'data:%' and doc->'before'->>'photo' <> 'data:(đã lược bỏ)';
