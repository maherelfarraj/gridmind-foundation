-- 0077_digital_thread.sql — polymorphic digital-thread graph + impact assessments. Idempotent.

create table if not exists public.entity_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid,
  source_type text not null,
  source_id uuid not null,
  link_type text not null,
  target_type text not null,
  target_id uuid not null,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.entity_links drop constraint if exists entity_links_type_check;
alter table public.entity_links add constraint entity_links_type_check check (
  source_type in ('opportunity','proposal','project','layout','simulation','sld','bom',
    'rfq','po','cwp','inspection','test','certificate','turnover','asset','work_order',
    'warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor',
    'contract','change_request','impact_assessment')
  and target_type in ('opportunity','proposal','project','layout','simulation','sld','bom',
    'rfq','po','cwp','inspection','test','certificate','turnover','asset','work_order',
    'warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor',
    'contract','change_request','impact_assessment')
);
alter table public.entity_links drop constraint if exists entity_links_link_type_check;
alter table public.entity_links add constraint entity_links_link_type_check
  check (link_type in ('derives','impacts','supersedes','references','fulfills'));
alter table public.entity_links drop constraint if exists entity_links_no_self;
alter table public.entity_links add constraint entity_links_no_self
  check (not (source_type = target_type and source_id = target_id));

create unique index if not exists entity_links_dedupe
  on public.entity_links(company_id, source_type, source_id, link_type, target_type, target_id);
create index if not exists entity_links_source_idx on public.entity_links(company_id, source_type, source_id);
create index if not exists entity_links_target_idx on public.entity_links(company_id, target_type, target_id);
create index if not exists entity_links_project_idx on public.entity_links(company_id, project_id);

create table if not exists public.impact_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid,
  event_type text not null,
  source_type text not null,
  source_id uuid not null,
  title text not null,
  summary text,
  severity text not null default 'medium',
  impacts jsonb not null default '[]',
  status text not null default 'open',
  change_request_id uuid,
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.impact_assessments drop constraint if exists impact_assessments_severity_check;
alter table public.impact_assessments add constraint impact_assessments_severity_check
  check (severity in ('low','medium','high','critical'));
alter table public.impact_assessments drop constraint if exists impact_assessments_status_check;
alter table public.impact_assessments add constraint impact_assessments_status_check
  check (status in ('open','acknowledged','resolved','dismissed'));
create index if not exists impact_assessments_source_idx
  on public.impact_assessments(company_id, source_type, source_id, status);
create index if not exists impact_assessments_project_idx
  on public.impact_assessments(company_id, project_id, status);

-- ---------------------------------------------------------------- RLS
alter table public.entity_links enable row level security;
alter table public.impact_assessments enable row level security;

drop policy if exists entity_links_select on public.entity_links;
create policy entity_links_select on public.entity_links for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists entity_links_insert on public.entity_links;
create policy entity_links_insert on public.entity_links for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists entity_links_delete on public.entity_links;
create policy entity_links_delete on public.entity_links for delete to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer()
         and (public.has_company_role('company_admin') or public.has_company_role('project_admin')));

drop policy if exists impact_select on public.impact_assessments;
create policy impact_select on public.impact_assessments for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists impact_insert on public.impact_assessments;
create policy impact_insert on public.impact_assessments for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists impact_update on public.impact_assessments;
create policy impact_update on public.impact_assessments for update to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer()
         and (public.has_company_role('company_admin') or public.has_company_role('project_admin')
              or public.has_company_role('om_admin') or created_by = auth.uid()))
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop trigger if exists trg_entity_links_updated on public.entity_links;
create trigger trg_entity_links_updated before update on public.entity_links
  for each row execute function public.set_updated_at();
drop trigger if exists trg_impact_updated on public.impact_assessments;
create trigger trg_impact_updated before update on public.impact_assessments
  for each row execute function public.set_updated_at();

create or replace function public.audit_thread_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (new.company_id, auth.uid(),
          tg_table_name || '.' || lower(tg_op), tg_table_name, new.id,
          case when tg_table_name = 'impact_assessments'
               then jsonb_build_object('status', new.status, 'event_type', new.event_type)
               else jsonb_build_object('link_type', new.link_type) end);
  return new;
end $$;
revoke all on function public.audit_thread_changes() from public, anon, authenticated;

drop trigger if exists trg_audit_links on public.entity_links;
create trigger trg_audit_links after insert on public.entity_links
  for each row execute function public.audit_thread_changes();
drop trigger if exists trg_audit_impacts on public.impact_assessments;
create trigger trg_audit_impacts after insert or update of status on public.impact_assessments
  for each row execute function public.audit_thread_changes();

-- ---------------------------------------------------------------- RPCs
create or replace function public.link_entities(
  p_source_type text,
  p_source_id uuid,
  p_link_type text,
  p_target_type text,
  p_target_id uuid,
  p_company_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_company_member(p_company_id) or public.is_external_viewer() then
    raise exception 'not_company_member' using errcode = '42501';
  end if;

  insert into public.entity_links (
    company_id, project_id, source_type, source_id, link_type,
    target_type, target_id, metadata, created_by)
  values (
    p_company_id,
    nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'project_id', '')::uuid,
    p_source_type, p_source_id, p_link_type, p_target_type, p_target_id,
    coalesce(p_metadata, '{}'::jsonb), auth.uid())
  on conflict (company_id, source_type, source_id, link_type, target_type, target_id)
  do nothing
  returning id into v_id;

  if v_id is null then
    update public.entity_links
       set metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
     where company_id = p_company_id
       and source_type = p_source_type and source_id = p_source_id
       and link_type = p_link_type
       and target_type = p_target_type and target_id = p_target_id
     returning id into v_id;
  end if;

  return v_id;
end $$;

create or replace function public.create_impact_assessment(
  p_event_type text,
  p_source_type text,
  p_source_id uuid,
  p_title text,
  p_impacts jsonb,
  p_company_id uuid,
  p_severity text default 'medium',
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_project uuid;
  v_impact jsonb;
begin
  if not public.is_company_member(p_company_id) or public.is_external_viewer() then
    raise exception 'not_company_member' using errcode = '42501';
  end if;

  select id into v_id
    from public.impact_assessments
   where company_id = p_company_id
     and event_type = p_event_type
     and source_type = p_source_type
     and source_id = p_source_id
     and status = 'open'
   order by created_at
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  v_project := nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'project_id', '')::uuid;

  insert into public.impact_assessments (
    company_id, project_id, event_type, source_type, source_id, title, summary,
    severity, impacts, metadata, created_by)
  values (
    p_company_id, v_project, p_event_type, p_source_type, p_source_id, p_title, p_summary,
    coalesce(p_severity, 'medium'), coalesce(p_impacts, '[]'::jsonb),
    coalesce(p_metadata, '{}'::jsonb), auth.uid())
  returning id into v_id;

  for v_impact in
    select value from jsonb_array_elements(coalesce(p_impacts, '[]'::jsonb))
  loop
    if coalesce(v_impact ->> 'entity_type', '') <> ''
       and nullif(v_impact ->> 'entity_id', '') is not null then
      begin
        perform public.link_entities(
          'impact_assessment', v_id, 'impacts',
          v_impact ->> 'entity_type', (v_impact ->> 'entity_id')::uuid,
          p_company_id,
          jsonb_strip_nulls(jsonb_build_object(
            'project_id', v_project,
            'area', v_impact ->> 'area',
            'action', v_impact ->> 'action')));
      exception when others then
        -- an out-of-vocabulary or malformed impact entry must not abort the assessment
        null;
      end;
    end if;
  end loop;

  return v_id;
end $$;

create or replace function public.get_entity_graph(
  p_entity_type text,
  p_entity_id uuid,
  p_depth int default 2
) returns jsonb
language sql stable security definer set search_path = public as $$
  with recursive bounded as (select least(greatest(coalesce(p_depth, 2), 1), 4) as d),
  walk as (
    select p_entity_type as node_type, p_entity_id as node_id, 0 as depth,
           array[p_entity_type || ':' || p_entity_id::text] as path,
           null::uuid as link_id
    union all
    select n.node_type, n.node_id, w.depth + 1,
           w.path || (n.node_type || ':' || n.node_id::text), n.link_id
      from walk w
      cross join bounded b
      join lateral (
        select el.target_type as node_type, el.target_id as node_id, el.id as link_id
          from public.entity_links el
         where el.source_type = w.node_type and el.source_id = w.node_id
           and public.is_company_member(el.company_id) and not public.is_external_viewer()
        union all
        select el.source_type, el.source_id, el.id
          from public.entity_links el
         where el.target_type = w.node_type and el.target_id = w.node_id
           and public.is_company_member(el.company_id) and not public.is_external_viewer()
      ) n on true
     where w.depth < b.d
       and not ((n.node_type || ':' || n.node_id::text) = any (w.path))
  ),
  nodes as (
    select distinct on (node_type, node_id)
           node_type, node_id, depth
      from walk
     order by node_type, node_id, depth
  ),
  edges as (
    select distinct el.id, el.source_type, el.source_id, el.link_type,
           el.target_type, el.target_id, el.project_id, el.metadata
      from public.entity_links el
     where public.is_company_member(el.company_id) and not public.is_external_viewer()
       and exists (select 1 from nodes n where n.node_type = el.source_type and n.node_id = el.source_id)
       and exists (select 1 from nodes n where n.node_type = el.target_type and n.node_id = el.target_id)
  )
  select jsonb_build_object(
    'root', jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
        'entity_type', node_type, 'entity_id', node_id, 'depth', depth)) from nodes), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'source_type', source_type, 'source_id', source_id,
        'link_type', link_type, 'target_type', target_type, 'target_id', target_id,
        'project_id', project_id, 'metadata', metadata)) from edges), '[]'::jsonb)
  );
$$;

create or replace function public.entity_link_orphans()
returns table (
  link_id uuid,
  company_id uuid,
  endpoint text,
  entity_type text,
  entity_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_map jsonb := jsonb_build_object(
    'opportunity','opportunities','proposal','proposals','project','projects',
    'layout','pv_layouts','simulation','pv_simulations','sld','sld_drawings',
    'bom','bom_snapshots','rfq','rfqs','po','purchase_orders',
    'cwp','construction_work_packages','inspection','qaqc_inspections',
    'test','commissioning_tests','certificate','test_certificates',
    'turnover','turnover_packages','asset','asset_nodes','work_order','work_orders',
    'warranty_claim','warranty_claims','drawing','drawing_register','document','documents',
    'equipment','equipment_registry','scada_alarm','scada_alarms','spare_part','spare_parts',
    'vendor','vendors','contract','contracts','change_request','change_orders',
    'impact_assessment','impact_assessments');
  r record;
  v_table text;
  v_exists boolean;
begin
  for r in
    select el.id, el.company_id, 'source' as endpoint, el.source_type as t, el.source_id as eid
      from public.entity_links el
     where public.is_company_member(el.company_id) and not public.is_external_viewer()
    union all
    select el.id, el.company_id, 'target', el.target_type, el.target_id
      from public.entity_links el
     where public.is_company_member(el.company_id) and not public.is_external_viewer()
  loop
    v_table := v_map ->> r.t;
    if v_table is null then
      continue; -- unknown type: unverifiable
    end if;
    if to_regclass('public.' || quote_ident(v_table)) is null then
      continue; -- table from a batch that does not exist yet
    end if;
    execute format('select exists (select 1 from public.%I where id = $1)', v_table)
      into v_exists using r.eid;
    if not v_exists then
      link_id := r.id; company_id := r.company_id; endpoint := r.endpoint;
      entity_type := r.t; entity_id := r.eid;
      return next;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- grants
grant select, insert, delete on public.entity_links to authenticated;
grant all on public.entity_links to service_role;
grant select, insert, update on public.impact_assessments to authenticated;
grant all on public.impact_assessments to service_role;

revoke all on function public.link_entities(text,uuid,text,text,uuid,uuid,jsonb) from public, anon;
revoke all on function public.create_impact_assessment(text,text,uuid,text,jsonb,uuid,text,text,jsonb) from public, anon;
revoke all on function public.get_entity_graph(text,uuid,int) from public, anon;
revoke all on function public.entity_link_orphans() from public, anon;
grant execute on function public.link_entities(text,uuid,text,text,uuid,uuid,jsonb),
  public.create_impact_assessment(text,text,uuid,text,jsonb,uuid,text,text,jsonb),
  public.get_entity_graph(text,uuid,int), public.entity_link_orphans() to authenticated;