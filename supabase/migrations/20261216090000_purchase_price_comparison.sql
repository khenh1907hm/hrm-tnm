-- Đơn hàng: thêm loại tệp "File so sánh giá" (price_comparison). Loại cũ giữ lại cho tệp đã đính kèm trước đây.
alter table public.purchase_attachments drop constraint if exists purchase_attachments_kind_check;
alter table public.purchase_attachments add constraint purchase_attachments_kind_check
  check (kind in ('signed_quote', 'price_comparison', 'tnm_quote', 'master_schedule', 'drawing'));
