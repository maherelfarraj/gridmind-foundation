create or replace function public.portfolio_hse_exposure()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_hse_exposure');
  v_now date := current_date;
  v_cur_start date := (v_now - interval '12 months')::date;
  v_prev_start date := (v_now - interval '24 months')::date;
  v_hours_cur numeric;
  v_hours_prev numeric;
  v_rec_cur numeric;
  v_rec_prev numeric;
  v_result jsonb;
begin
  select coalesce(sum(ml.hours) filter (where dr.report_date >= v_cur_start), 0),
         coalesce(sum(ml.hours) filter (where dr.report_date >= v_prev_start
                                          and dr.report_date < v_cur_start), 0)
    into v_hours_cur, v_hours_prev
  from public.manpower_logs ml
  join public.construction_daily_reports dr on dr.id = ml.dpr_id
  where ml.company_id = v_company;

  select count(*) filter (where i.occurred_at >= v_cur_start),
         count(*) filter (where i.occurred_at >= v_prev_start and i.occurred_at < v_cur_start)
    into v_rec_cur, v_rec_prev
  from public.hse_incidents i
  where i.company_id = v_company and coalesce(i.osha_recordable, false);

  select jsonb_build_object(
    'incidents_open', (select count(*) from public.hse_incidents
        where company_id = v_company and status::text <> 'closed'),
    'incidents_by_severity', coalesce((select jsonb_object_agg(sev, n) from (
        select severity::text sev, count(*) n
        from public.hse_incidents
        where company_id = v_company and status::text <> 'closed'
        group by 1) s), '{}'::jsonb),
    'trir_current', case when v_hours_cur > 0
        then round(v_rec_cur * 200000 / v_hours_cur, 4) else null end,
    'trir_prior', case when v_hours_prev > 0
        then round(v_rec_prev * 200000 / v_hours_prev, 4) else null end,
    'exposure_hours_current', v_hours_cur,
    'exposure_hours_prior', v_hours_prev,
    'punch_open', coalesce((select jsonb_object_agg(category, n) from (
        select category::text category, count(*) n
        from public.qaqc_punch_items
        where company_id = v_company and status::text in ('open', 'ready_for_review')
        group by 1) pc), '{}'::jsonb),
    'ncr_open_by_status', coalesce((select jsonb_object_agg(st, n) from (
        select status::text st, count(*) n
        from public.ncrs
        where company_id = v_company and status::text in ('open', 'in_progress')
        group by 1) nc), '{}'::jsonb),
    'hold_points_open', (select count(*)
        from public.itp_steps s
        join public.inspection_test_plans itp on itp.id = s.itp_id
        where itp.company_id = v_company
          and s.point_type::text = 'hold'
          and s.status::text = 'pending'),
    'by_project', coalesce((select jsonb_agg(row_to_json(t)) from (
        select p.id project_id, p.code project_code, p.name project_name,
          (select count(*) from public.hse_incidents i
             where i.project_id = p.id and i.status::text <> 'closed') incidents_open,
          (select count(*) from public.qaqc_punch_items q
             where q.project_id = p.id and q.status::text in ('open', 'ready_for_review')
               and q.category::text = 'A') punch_a_open,
          (select count(*) from public.qaqc_punch_items q
             where q.project_id = p.id and q.status::text in ('open', 'ready_for_review')
               and q.category::text = 'B') punch_b_open,
          (select count(*) from public.qaqc_punch_items q
             where q.project_id = p.id and q.status::text in ('open', 'ready_for_review')
               and q.category::text = 'C') punch_c_open,
          (select count(*) from public.ncrs n
             where n.project_id = p.id and n.status::text in ('open', 'in_progress')) ncr_open,
          (select count(*)
             from public.itp_steps s
             join public.inspection_test_plans itp on itp.id = s.itp_id
             where itp.project_id = p.id
               and s.point_type::text = 'hold'
               and s.status::text = 'pending') hold_points_open,
          (select max(i.occurred_at) from public.hse_incidents i
             where i.project_id = p.id) last_incident_at,
          (select case when max(i.occurred_at) is null then null
                  else greatest(0, (v_now - max(i.occurred_at)::date)) end
             from public.hse_incidents i where i.project_id = p.id) days_since_last_incident
        from public.projects p
        where p.company_id = v_company
        order by p.code) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.portfolio_hse_exposure() from public, anon;
grant execute on function public.portfolio_hse_exposure() to authenticated;