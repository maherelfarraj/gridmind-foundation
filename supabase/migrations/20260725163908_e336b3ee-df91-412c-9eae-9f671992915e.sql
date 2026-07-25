-- Tenancy scoping on admin policies (same class as investor_share_links fix)
drop policy if exists projects_admin on public.projects;
create policy projects_admin on public.projects for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('company_admin') or public.has_company_role('project_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('company_admin') or public.has_company_role('project_admin')));

drop policy if exists project_members_admin on public.project_members;
create policy project_members_admin on public.project_members for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('company_admin') or public.has_company_role('project_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('company_admin') or public.has_company_role('project_admin')));

drop policy if exists memberships_admin_write on public.portal_memberships;
create policy memberships_admin_write on public.portal_memberships for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('company_admin') or public.has_company_role('project_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('company_admin') or public.has_company_role('project_admin')));

-- Fix portal_get_feed KPI block: evm_snapshots real columns
create or replace function public.portal_get_feed(p_project_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_m       public.portal_memberships;
  v_project jsonb := '{}'::jsonb;
  v_out     jsonb;
  v_exposure jsonb;
begin
  v_m := public.portal_assert_access(p_project_id);
  v_exposure := v_m.exposure;

  if to_regclass('public.projects') is not null then
    select to_jsonb(t) into v_project
    from (
      select p.id, p.name, p.code, p.phase, p.status
      from public.projects p
      where p.id = p_project_id
    ) t;
  end if;

  v_out := jsonb_build_object(
    'membership_id', v_m.id,
    'project', coalesce(v_project, '{}'::jsonb),
    'exposure', v_exposure,
    'as_of', now()
  );

  if coalesce(v_exposure->>'milestones','false') = 'true'
     and to_regclass('public.project_phase_gates') is not null then
    v_out := v_out || jsonb_build_object(
      'milestones',
      coalesce((
        select jsonb_agg(to_jsonb(t) order by t.sort_order nulls last, t.approved_at nulls last)
        from (
          select g.id, g.name, g.phase, g.status, g.sort_order,
                 g.checklist, g.approved_at
          from public.project_phase_gates g
          where g.project_id = p_project_id
        ) t
      ), '[]'::jsonb)
    );
  end if;

  if coalesce(v_exposure->>'kpis','false') = 'true'
     and to_regclass('public.evm_snapshots') is not null then
    v_out := v_out || jsonb_build_object(
      'kpis',
      coalesce((
        select to_jsonb(t) from (
          select e.snapshot_date        as as_of_date,
                 e.spi, e.cpi,
                 e.planned_value        as pv,
                 e.earned_value         as ev,
                 e.actual_cost          as ac,
                 e.budget_at_completion as bac,
                 e.estimate_at_completion as eac
          from public.evm_snapshots e
          where e.project_id = p_project_id
          order by e.snapshot_date desc
          limit 1
        ) t
      ), '{}'::jsonb)
    );
  end if;

  if coalesce(v_exposure->>'photos','false') = 'true'
     and to_regclass('public.site_photos') is not null then
    v_out := v_out || jsonb_build_object(
      'photos',
      coalesce((
        select jsonb_agg(to_jsonb(t) order by t.taken_at desc nulls last)
        from (
          select sp.id, sp.storage_path, sp.caption, sp.taken_at, sp.discipline
          from public.site_photos sp
          where sp.project_id = p_project_id
          order by sp.taken_at desc nulls last
          limit 200
        ) t
      ), '[]'::jsonb)
    );
  end if;

  perform public._portal_log(
    v_m.company_id, p_project_id, v_m.id, auth.uid(),
    'portal.feed_viewed', '{}'::jsonb
  );

  return v_out;
end $function$;