-- P-174 — alarm workflow columns (extends P-105 acknowledge flow). Idempotent.
alter table public.scada_alarms add column if not exists assigned_to uuid references public.profiles(id);
alter table public.scada_alarms add column if not exists rca_status text not null default 'open';
alter table public.scada_alarms add column if not exists root_cause text;
alter table public.scada_alarms add column if not exists rca_notes text;
alter table public.scada_alarms drop constraint if exists scada_alarms_rca_status_check;
alter table public.scada_alarms add constraint scada_alarms_rca_status_check
  check (rca_status in ('open','triaged','root_cause_identified','closed'));
create index if not exists alarms_assigned_idx on public.scada_alarms(assigned_to, status);