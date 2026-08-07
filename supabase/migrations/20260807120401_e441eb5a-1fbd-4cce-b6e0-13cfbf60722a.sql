-- GC-09 — Portfolio governance: audit-trail indexes + per-user saved views.

create index if not exists audit_logs_company_action_created_idx
  on public.audit_logs (company_id, action, created_at desc);

create index if not exists audit_logs_company_actor_created_idx
  on public.audit_logs (company_id, actor_id, created_at desc);

create index if not exists audit_logs_metadata_gin_idx
  on public.audit_logs using gin (metadata jsonb_path_ops);

create table if not exists public.portfolio_saved_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  config_version integer not null default 1,
  config jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_saved_views_name_len
    check (char_length(btrim(name)) between 1 and 80),
  constraint portfolio_saved_views_config_object
    check (jsonb_typeof(config) = 'object')
);

create unique index if not exists portfolio_saved_views_owner_name_key
  on public.portfolio_saved_views (owner_id, lower(btrim(name)));

create unique index if not exists portfolio_saved_views_one_default_idx
  on public.portfolio_saved_views (owner_id) where is_default;

create index if not exists portfolio_saved_views_company_shared_idx
  on public.portfolio_saved_views (company_id, is_shared);

create index if not exists portfolio_saved_views_owner_idx
  on public.portfolio_saved_views (owner_id, updated_at desc);

grant select, insert, update, delete on public.portfolio_saved_views to authenticated;
grant all on public.portfolio_saved_views to service_role;

alter table public.portfolio_saved_views enable row level security;

drop policy if exists portfolio_saved_views_select on public.portfolio_saved_views;
create policy portfolio_saved_views_select on public.portfolio_saved_views
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (is_shared and public.is_company_member(company_id))
  );

drop policy if exists portfolio_saved_views_insert on public.portfolio_saved_views;
create policy portfolio_saved_views_insert on public.portfolio_saved_views
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.is_company_member(company_id)
    and (
      is_shared = false
      or public.has_company_role('finance_admin'::app_role)
      or public.has_company_role('company_admin'::app_role)
    )
  );

drop policy if exists portfolio_saved_views_update on public.portfolio_saved_views;
create policy portfolio_saved_views_update on public.portfolio_saved_views
  for update to authenticated
  using (owner_id = auth.uid() and public.is_company_member(company_id))
  with check (
    owner_id = auth.uid()
    and public.is_company_member(company_id)
    and (
      is_shared = false
      or public.has_company_role('finance_admin'::app_role)
      or public.has_company_role('company_admin'::app_role)
    )
  );

drop policy if exists portfolio_saved_views_delete on public.portfolio_saved_views;
create policy portfolio_saved_views_delete on public.portfolio_saved_views
  for delete to authenticated
  using (owner_id = auth.uid());

create or replace function public.portfolio_saved_views_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.name := btrim(new.name);
  if new.is_default then
    update public.portfolio_saved_views
       set is_default = false, updated_at = now()
     where owner_id = new.owner_id
       and is_default
       and id <> new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.portfolio_saved_views_before_write() from public;

drop trigger if exists portfolio_saved_views_before_write_trg on public.portfolio_saved_views;
create trigger portfolio_saved_views_before_write_trg
  before insert or update on public.portfolio_saved_views
  for each row execute function public.portfolio_saved_views_before_write();