-- Thông tin nhà cung cấp trên PO (P-CC-08): Địa chỉ, Điện thoại, Email (ô vàng của mẫu); supplier_contact là người liên hệ (ô "Tới").
alter table public.purchase_orders
  add column if not exists supplier_address text not null default '',
  add column if not exists supplier_phone text not null default '',
  add column if not exists supplier_email text not null default '';

-- Đơn cũ: ô liên hệ từng gộp "điện thoại · email · MST" → tách điện thoại, email sang cột riêng; phần còn lại (nếu có chữ) giữ làm người liên hệ
with parsed as (
  select id,
    coalesce(substring(supplier_contact from '(\+?\d[\d .-]{7,}\d)'), '') as phone,
    coalesce(substring(supplier_contact from '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})'), '') as email,
    btrim(regexp_replace(supplier_contact, '(MST\s*[0-9-]+)|(\+?\d[\d .-]{7,}\d)|([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})', '', 'g'), ' ·,;-') as rest
  from public.purchase_orders
  where supplier_phone = '' and supplier_email = '' and supplier_contact ~ '(\d{3}[\d .-]{5,}|@)'
)
update public.purchase_orders o set
  supplier_phone = p.phone,
  supplier_email = p.email,
  supplier_contact = case when regexp_replace(p.rest, '[\s·,;-]', '', 'g') = '' then '' else p.rest end
from parsed p where p.id = o.id;
