alter table public.terrain_surfaces
  add column if not exists analysis jsonb not null default '{}'::jsonb;