-- Chứng chỉ không có thời hạn (bằng cấp…): expiry_date được để trống.
-- Loại chứng chỉ có cờ doc.noExpiry; bản ghi cũ không có cờ này = có hạn.
alter table public.certificates alter column expiry_date drop not null;

-- Ba loại tự thêm từ hồ sơ giấy thật (TNM0015): CCCD, bằng cấp chuyên môn, sức khỏe làm việc trên cao.
-- Bỏ qua nếu đã có loại cùng mã hoặc cùng tên (không phân biệt hoa thường) để chạy lại không bị trùng.
with new_types (id, name, english_name, no_expiry, offset_order) as (
  values
    ('ctype-cccd', 'Căn cước công dân', 'Citizen identity card', false, 1),
    ('ctype-degree', 'Bằng cấp chuyên môn', 'Professional qualification', true, 2),
    ('ctype-height-health', 'Sức khỏe làm việc trên cao', 'Fitness for work at height', false, 3)
),
base as (
  select coalesce(max((doc ->> 'sortOrder')::integer), 0) as max_order from public.certificate_types
),
to_insert as (
  select n.*, b.max_order + n.offset_order as sort_order
  from new_types n cross join base b
  where not exists (
    select 1 from public.certificate_types t
    where t.id = n.id or lower(t.doc ->> 'name') = lower(n.name)
  )
),
inserted as (
  insert into public.certificate_types (id, version, key, doc)
  select id, 1, 'custom-' || id, jsonb_build_object(
    'id', id, 'key', 'custom-' || id, 'name', name, 'englishName', english_name,
    'requiredForPositions', '[]'::jsonb, 'sortOrder', sort_order, 'system', false,
    'archived', false, 'archiveReason', null, 'version', 1, 'noExpiry', no_expiry
  )
  from to_insert
  returning id, doc
)
insert into public.audit_events (id, at, actor_id, action, entity_type, entity_id, doc)
select 'audit-migration-' || id, now(), 'system-migration', 'certificateType.create', 'certificateType', id,
  jsonb_build_object('id', 'audit-migration-' || id, 'at', now(), 'actorId', 'system-migration', 'role', 'admin',
    'action', 'certificateType.create', 'entityType', 'certificateType', 'entityId', id, 'before', null, 'after', doc)
from inserted;
