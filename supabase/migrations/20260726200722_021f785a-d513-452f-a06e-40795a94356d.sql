-- 0073_scada_reliability.sql — ingestion retry + dead-letter queues. Idempotent.

do $$ begin
  create type public.ingestion_queue_status as enum ('pending','processing','retried','dead');
exception when duplicate_object then null; end $$;

create table if not exists public.ingestion_retry_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  connector_id uuid references public.scada_connectors(id) on delete set null,
  payload jsonb not null,
  payload_kind text not null default 'telemetry',
  error text not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_retry_at timestamptz not null default now(),
  status public.ingestion_queue_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists retry_queue_due_idx
  on public.ingestion_retry_queue(status, next_retry_at) where status in ('pending','retried');
create index if not exists retry_queue_company_idx
  on public.ingestion_retry_queue(company_id, status);

create table if not exists public.ingestion_dead_letter (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  connector_id uuid references public.scada_connectors(id) on delete set null,
  payload jsonb not null,
  payload_kind text not null default 'telemetry',
  first_error text,
  final_error text not null,
  attempts int not null,
  failed_at timestamptz not null default now(),
  replayed_at timestamptz,
  replayed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists dead_letter_company_idx
  on public.ingestion_dead_letter(company_id, replayed_at, failed_at desc);

alter table public.ingestion_retry_queue enable row level security;
alter table public.ingestion_dead_letter enable row level security;

drop policy if exists retry_select on public.ingestion_retry_queue;
create policy retry_select on public.ingestion_retry_queue for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists dlq_select on public.ingestion_dead_letter;
create policy dlq_select on public.ingestion_dead_letter for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists dlq_replay on public.ingestion_dead_letter;
create policy dlq_replay on public.ingestion_dead_letter for update to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

grant select on public.ingestion_retry_queue to authenticated;
grant select, update on public.ingestion_dead_letter to authenticated;
grant all on public.ingestion_retry_queue to service_role;
grant all on public.ingestion_dead_letter to service_role;

drop trigger if exists trg_retry_queue_updated on public.ingestion_retry_queue;
create trigger trg_retry_queue_updated before update on public.ingestion_retry_queue
  for each row execute function public.set_updated_at();