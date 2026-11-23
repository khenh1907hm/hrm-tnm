-- Bán kính chấm công GPS cố định 50 m cho mọi dự án (form dự án không còn chọn bán kính).
alter table public.projects alter column site_radius_m set default 50;
update public.projects set site_radius_m = 50 where site_radius_m <> 50;
