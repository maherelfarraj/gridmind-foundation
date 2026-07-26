-- 0070_ea_protection.sql — protection schedule, relay settings, grid-code checklists (P-168). Idempotent.

create table if not exists public.ea_protection_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  study_id uuid references public.ea_studies(id) on delete set null,
  source text not null default 'manual' check (source in ('sld','manual')),
  sld_object_id uuid,
  tag text not null,
  device_type text not null default 'circuit_breaker'
    check (device_type in ('circuit_breaker','fuse','relay','contactor','disconnector','mccb','acb','vcb','other')),
  ansi_codes text[] not null default '{}',
  voltage_kv numeric, rated_current_a numeric,
  breaking_capacity_ka numeric, making_capacity_ka numeric,
  ct_ratio text, vt_ratio text, curve_type text,
  notes text, sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, tag)
);

create table if not exists public.ea_relay_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.ea_protection_devices(id) on delete cascade,
  revision int not null default 0,
  setting_group int not null default 1,
  function_code text not null,
  pickup numeric, time_dial numeric, curve text, delay_s numeric, unit text,
  settings jsonb not null default '{}',
  set_by uuid references public.profiles(id), set_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, revision, setting_group, function_code)
);

create table if not exists public.ea_grid_code_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  market text not null,
  name text not null,
  version text not null default '1.0',
  items jsonb not null default '[]',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, market, version)
);

create table if not exists public.ea_grid_code_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid not null references public.ea_grid_code_templates(id) on delete cascade,
  study_id uuid references public.ea_studies(id) on delete set null,
  item_index int not null,
  status text not null default 'open'
    check (status in ('open','evidence_pending','compliant','non_compliant','not_applicable')),
  evidence text, comment text,
  responded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, project_id, item_index)
);

create index if not exists ea_protection_devices_project_idx
  on public.ea_protection_devices(project_id, device_type);
create index if not exists ea_relay_settings_device_idx
  on public.ea_relay_settings(device_id, revision);
create index if not exists ea_grid_code_responses_project_idx
  on public.ea_grid_code_responses(project_id, template_id);

drop trigger if exists set_updated_at on public.ea_protection_devices;
create trigger set_updated_at before update on public.ea_protection_devices
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.ea_relay_settings;
create trigger set_updated_at before update on public.ea_relay_settings
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.ea_grid_code_templates;
create trigger set_updated_at before update on public.ea_grid_code_templates
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.ea_grid_code_responses;
create trigger set_updated_at before update on public.ea_grid_code_responses
  for each row execute function public.set_updated_at();

alter table public.ea_protection_devices enable row level security;
alter table public.ea_relay_settings enable row level security;
alter table public.ea_grid_code_templates enable row level security;
alter table public.ea_grid_code_responses enable row level security;

drop policy if exists ea_prot_dev_select on public.ea_protection_devices;
create policy ea_prot_dev_select on public.ea_protection_devices for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_prot_dev_insert on public.ea_protection_devices;
create policy ea_prot_dev_insert on public.ea_protection_devices for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')));
drop policy if exists ea_prot_dev_update on public.ea_protection_devices;
create policy ea_prot_dev_update on public.ea_protection_devices for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists ea_relay_select on public.ea_relay_settings;
create policy ea_relay_select on public.ea_relay_settings for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_relay_insert on public.ea_relay_settings;
create policy ea_relay_insert on public.ea_relay_settings for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')));
-- No UPDATE/DELETE policies or grants on ea_relay_settings: revisioned, append-only.

drop policy if exists ea_gc_tpl_select on public.ea_grid_code_templates;
create policy ea_gc_tpl_select on public.ea_grid_code_templates for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_gc_tpl_insert on public.ea_grid_code_templates;
create policy ea_gc_tpl_insert on public.ea_grid_code_templates for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')));
drop policy if exists ea_gc_tpl_update on public.ea_grid_code_templates;
create policy ea_gc_tpl_update on public.ea_grid_code_templates for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')));

drop policy if exists ea_gc_resp_select on public.ea_grid_code_responses;
create policy ea_gc_resp_select on public.ea_grid_code_responses for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_gc_resp_insert on public.ea_grid_code_responses;
create policy ea_gc_resp_insert on public.ea_grid_code_responses for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')));
drop policy if exists ea_gc_resp_update on public.ea_grid_code_responses;
create policy ea_gc_resp_update on public.ea_grid_code_responses for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'company_admin')));

revoke all on public.ea_protection_devices from anon;
revoke all on public.ea_relay_settings from anon;
revoke all on public.ea_grid_code_templates from anon;
revoke all on public.ea_grid_code_responses from anon;

grant select, insert, update on public.ea_protection_devices to authenticated;
grant select, insert on public.ea_relay_settings to authenticated;
grant select, insert, update on public.ea_grid_code_templates to authenticated;
grant select, insert, update on public.ea_grid_code_responses to authenticated;
grant all on public.ea_protection_devices to service_role;
grant all on public.ea_relay_settings to service_role;
grant all on public.ea_grid_code_templates to service_role;
grant all on public.ea_grid_code_responses to service_role;

insert into public.ea_grid_code_templates (company_id, market, name, version, items, is_active)
select c.id, 'Jordan NEPCO',
  'NEPCO grid code — connection checklist (starter template, verify current issue)',
  '0.1-draft',
  '[
    {"code":"GCC-01","category":"Voltage","requirement":"Voltage operating range and regulation at the point of interconnection (POI) per the NEPCO grid code; verify against the current issued version.","evidence_required":true},
    {"code":"GCC-02","category":"Frequency","requirement":"Continuous operation within the NEPCO frequency band; under/over-frequency protection settings coordinated.","evidence_required":true},
    {"code":"GCC-03","category":"Reactive power","requirement":"Reactive-power capability and power-factor range at the POI (typically 0.95 lag/lead for MV connections — confirm the contracted range).","evidence_required":true},
    {"code":"GCC-04","category":"Fault ride-through","requirement":"LVRT/HVRT ride-through capability curve per NEPCO requirements.","evidence_required":true},
    {"code":"GCC-05","category":"Power quality","requirement":"Harmonic emission at the POI assessed against NEPCO / IEEE 519-style limits; flicker limits.","evidence_required":true},
    {"code":"GCC-06","category":"Protection","requirement":"Protection settings and coordination approved by NEPCO; anti-islanding protection for embedded generation.","evidence_required":true},
    {"code":"GCC-07","category":"Communications","requirement":"Telemetry/SCADA interface to the NEPCO National Control Center (RTU signal list).","evidence_required":true},
    {"code":"GCC-08","category":"Earthing","requirement":"Earthing-system design and touch/step-potential assessment submitted for review.","evidence_required":true}
  ]'::jsonb,
  true
from public.companies c
on conflict (company_id, market, version) do nothing;