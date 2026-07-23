-- 0009_api_webhooks.sql

-- =====================================================================
-- api_keys
-- =====================================================================
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_keys_company_id_idx on public.api_keys(company_id);

grant select, insert, update, delete on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

alter table public.api_keys enable row level security;

drop policy if exists "api_keys select company members" on public.api_keys;
create policy "api_keys select company members"
  on public.api_keys for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "api_keys insert company admins" on public.api_keys;
create policy "api_keys insert company admins"
  on public.api_keys for insert to authenticated
  with check (public.is_company_admin(company_id));

drop policy if exists "api_keys update company admins" on public.api_keys;
create policy "api_keys update company admins"
  on public.api_keys for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop trigger if exists update_api_keys_updated_at on public.api_keys;
create trigger update_api_keys_updated_at
  before update on public.api_keys
  for each row execute function public.update_updated_at_column();

-- =====================================================================
-- webhook_endpoints
-- =====================================================================
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  url text not null,
  description text,
  signing_secret_hash text not null,
  events text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_endpoints_company_id_idx on public.webhook_endpoints(company_id);

grant select, insert, update, delete on public.webhook_endpoints to authenticated;
grant all on public.webhook_endpoints to service_role;

alter table public.webhook_endpoints enable row level security;

drop policy if exists "webhook_endpoints select company members" on public.webhook_endpoints;
create policy "webhook_endpoints select company members"
  on public.webhook_endpoints for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "webhook_endpoints insert company admins" on public.webhook_endpoints;
create policy "webhook_endpoints insert company admins"
  on public.webhook_endpoints for insert to authenticated
  with check (public.is_company_admin(company_id));

drop policy if exists "webhook_endpoints update company admins" on public.webhook_endpoints;
create policy "webhook_endpoints update company admins"
  on public.webhook_endpoints for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop policy if exists "webhook_endpoints delete company admins" on public.webhook_endpoints;
create policy "webhook_endpoints delete company admins"
  on public.webhook_endpoints for delete to authenticated
  using (public.is_company_admin(company_id));

drop trigger if exists update_webhook_endpoints_updated_at on public.webhook_endpoints;
create trigger update_webhook_endpoints_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.update_updated_at_column();

-- =====================================================================
-- webhook_deliveries
-- =====================================================================
do $$ begin
  create type public.delivery_status as enum ('pending','success','failed');
exception when duplicate_object then null; end $$;

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.delivery_status not null default 'pending',
  attempts int not null default 0,
  next_retry_at timestamptz,
  response_status int,
  response_body text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_company_id_idx on public.webhook_deliveries(company_id);
create index if not exists webhook_deliveries_endpoint_id_idx on public.webhook_deliveries(endpoint_id);
create index if not exists webhook_deliveries_status_next_retry_idx
  on public.webhook_deliveries(status, next_retry_at);

grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_deliveries to service_role;

alter table public.webhook_deliveries enable row level security;

drop policy if exists "webhook_deliveries select company members" on public.webhook_deliveries;
create policy "webhook_deliveries select company members"
  on public.webhook_deliveries for select to authenticated
  using (public.is_company_member(company_id));

drop trigger if exists update_webhook_deliveries_updated_at on public.webhook_deliveries;
create trigger update_webhook_deliveries_updated_at
  before update on public.webhook_deliveries
  for each row execute function public.update_updated_at_column();

-- =====================================================================
-- verify_api_key
-- =====================================================================
create or replace function public.verify_api_key(p_raw_key text)
returns table(key_id uuid, company_id uuid, scopes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_raw_key is null or length(p_raw_key) = 0 then
    return;
  end if;

  v_hash := encode(digest(p_raw_key, 'sha256'), 'hex');

  return query
  update public.api_keys ak
     set last_used_at = now()
   where ak.key_hash = v_hash
     and ak.revoked_at is null
     and (ak.expires_at is null or ak.expires_at > now())
  returning ak.id, ak.company_id, ak.scopes;
end;
$$;

revoke all on function public.verify_api_key(text) from public;
grant execute on function public.verify_api_key(text) to anon;
grant execute on function public.verify_api_key(text) to authenticated;
grant execute on function public.verify_api_key(text) to service_role;