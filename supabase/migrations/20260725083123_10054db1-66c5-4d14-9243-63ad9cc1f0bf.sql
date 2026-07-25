alter table public.wbs_items
  add column if not exists planned_quantity numeric(14,3),
  add column if not exists uom text,
  add column if not exists area text;

create index if not exists wbs_items_project_area_discipline_idx
  on public.wbs_items(project_id, area, discipline);