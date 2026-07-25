alter table public.qaqc_punch_items
  add column if not exists utility_witness_required boolean not null default false,
  add column if not exists closed_by uuid references public.profiles(id);
