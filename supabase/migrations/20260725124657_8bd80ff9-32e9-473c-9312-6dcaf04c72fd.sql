
-- P-115 — investor_share_links: tokenized, expiring, scope-limited public views.

create table if not exists public.investor_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  label text not null,
  token_hash text not null unique,
  role public.app_role not null check (role in ('investor_viewer','lender_viewer')),
  scope jsonb not null default '{"project_ids":[],"sections":["kpis","milestones"]}'::jsonb,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  last_accessed_at timestamptz,
  access_count int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.investor_share_links to authenticated;
grant all on public.investor_share_links to service_role;

alter table public.investor_share_links enable row level security;

drop policy if exists share_links_admin on public.investor_share_links;
create policy share_links_admin on public.investor_share_links
  for all
  to authenticated
  using (public.has_company_role('company_admin'))
  with check (public.has_company_role('company_admin'));

drop trigger if exists trg_share_links_updated on public.investor_share_links;
create trigger trg_share_links_updated
  before update on public.investor_share_links
  for each row execute function public.set_updated_at();

create index if not exists share_links_company_idx
  on public.investor_share_links(company_id, expires_at);

-- ---------------------------------------------------------------------------
-- resolve_share_link: SECURITY DEFINER; anon-callable via the /share/<token>
-- public route. Returns curated data only.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_share_link(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.investor_share_links%rowtype;
  v_project_ids uuid[] := array[]::uuid[];
  v_sections text[] := array[]::text[];
  v_include_financials boolean := false;
  v_out jsonb;
  v_company jsonb := '{}'::jsonb;
  v_projects jsonb := '[]'::jsonb;
  v_milestones jsonb := '[]'::jsonb;
  v_photos jsonb := '[]'::jsonb;
  v_kpis jsonb := '[]'::jsonb;
  v_financials jsonb := '[]'::jsonb;
  v_pid uuid;
begin
  if p_token_hash is null or length(p_token_hash) <> 64 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_link
    from public.investor_share_links
   where token_hash = p_token_hash
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  if v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Parse scope.
  begin
    select coalesce(array_agg((val)::uuid), array[]::uuid[])
      into v_project_ids
      from jsonb_array_elements_text(coalesce(v_link.scope->'project_ids', '[]'::jsonb)) as val;
  exception when others then
    v_project_ids := array[]::uuid[];
  end;

  select coalesce(array_agg(val), array[]::text[])
    into v_sections
    from jsonb_array_elements_text(coalesce(v_link.scope->'sections', '[]'::jsonb)) as val;

  v_include_financials := ('financials' = any(v_sections))
                          and v_link.role = 'lender_viewer';

  -- Increment usage.
  update public.investor_share_links
     set access_count = access_count + 1,
         last_accessed_at = now()
   where id = v_link.id;

  -- Audit one row per scoped project.
  if to_regclass('public.portal_audit_events') is not null then
    foreach v_pid in array v_project_ids loop
      begin
        insert into public.portal_audit_events
          (company_id, project_id, membership_id, actor_id, event, metadata)
        values
          (v_link.company_id, v_pid, null, null, 'share_link.viewed',
           jsonb_build_object(
             'share_link_id', v_link.id,
             'role', v_link.role,
             'sections', to_jsonb(v_sections)));
      exception when others then
        -- never fail the view on audit issues
        null;
      end;
    end loop;
  end if;

  -- Company + branding.
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'branding', jsonb_build_object(
      'logo_url', cb.logo_url,
      'primary_color', cb.primary_color,
      'accent_color', cb.accent_color,
      'footer_text', cb.footer_text
    )
  )
    into v_company
    from public.companies c
    left join public.company_branding cb on cb.company_id = c.id
   where c.id = v_link.company_id;

  -- Projects (id/name/phase only).
  if array_length(v_project_ids, 1) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'phase', p.phase
           ) order by p.name), '[]'::jsonb)
      into v_projects
      from public.projects p
     where p.company_id = v_link.company_id
       and p.id = any(v_project_ids);
  end if;

  -- Milestones.
  if 'milestones' = any(v_sections)
     and to_regclass('public.project_phase_gates') is not null
     and array_length(v_project_ids, 1) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', g.id,
             'project_id', g.project_id,
             'phase', g.phase,
             'status', g.status,
             'planned_date', g.planned_date,
             'actual_date', g.actual_date,
             'notes', g.notes
           ) order by g.planned_date nulls last), '[]'::jsonb)
      into v_milestones
      from public.project_phase_gates g
     where g.project_id = any(v_project_ids);
  end if;

  -- Photos (raw storage paths — signed URLs generated server-side in the caller).
  if 'photos' = any(v_sections)
     and to_regclass('public.site_photos') is not null
     and array_length(v_project_ids, 1) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sp.id,
             'project_id', sp.project_id,
             'storage_path', sp.storage_path,
             'caption', sp.caption,
             'taken_at', sp.taken_at
           ) order by sp.taken_at desc nulls last), '[]'::jsonb)
      into v_photos
      from (
        select id, project_id, storage_path, caption, taken_at
          from public.site_photos
         where project_id = any(v_project_ids)
         order by taken_at desc nulls last
         limit 200
      ) sp;
  end if;

  -- KPIs (latest EVM snapshot per project).
  if 'kpis' = any(v_sections)
     and to_regclass('public.evm_snapshots') is not null
     and array_length(v_project_ids, 1) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'project_id', e.project_id,
             'as_of_date', e.snapshot_date,
             'spi', e.spi,
             'cpi', e.cpi,
             'pv', e.planned_value,
             'ev', e.earned_value,
             'ac', e.actual_cost,
             'bac', e.budget_at_completion
           )), '[]'::jsonb)
      into v_kpis
      from (
        select distinct on (project_id) *
          from public.evm_snapshots
         where project_id = any(v_project_ids)
         order by project_id, snapshot_date desc
      ) e;
  end if;

  -- Financials (lender_viewer only).
  if v_include_financials
     and to_regclass('public.cash_flows') is not null
     and array_length(v_project_ids, 1) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'project_id', cf.project_id,
             'currency_code', cf.currency_code,
             'inflow_total', cf.inflow_total,
             'outflow_total', cf.outflow_total,
             'net', cf.net
           )), '[]'::jsonb)
      into v_financials
      from (
        select
          project_id,
          max(currency_code) as currency_code,
          coalesce(sum(case when direction = 'inflow'  and not voided then amount else 0 end), 0) as inflow_total,
          coalesce(sum(case when direction = 'outflow' and not voided then amount else 0 end), 0) as outflow_total,
          coalesce(sum(case
            when voided then 0
            when direction = 'inflow'  then amount
            when direction = 'outflow' then -amount
            else 0 end), 0) as net
        from public.cash_flows
        where project_id = any(v_project_ids)
        group by project_id
      ) cf;
  end if;

  v_out := jsonb_build_object(
    'ok', true,
    'role', v_link.role,
    'label', v_link.label,
    'expires_at', v_link.expires_at,
    'sections', to_jsonb(v_sections),
    'company', coalesce(v_company, '{}'::jsonb),
    'projects', v_projects
  );

  if 'milestones' = any(v_sections) then
    v_out := v_out || jsonb_build_object('milestones', v_milestones);
  end if;
  if 'photos' = any(v_sections) then
    v_out := v_out || jsonb_build_object('photos', v_photos);
  end if;
  if 'kpis' = any(v_sections) then
    v_out := v_out || jsonb_build_object('kpis', v_kpis);
  end if;
  if v_include_financials then
    v_out := v_out || jsonb_build_object('financials', v_financials);
  end if;

  return v_out;
end
$$;

revoke all on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;
