-- P-162 — Server-side geometry-kind enforcement for civil features.
create or replace function public.civil_geometry_kind(p_type public.civil_feature_type)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'grading_zone' then 'polygon'
    when 'flood_risk_zone' then 'polygon'
    when 'equipment_platform' then 'polygon'
    when 'laydown_area' then 'polygon'
    when 'construction_compound' then 'polygon'
    when 'gate' then 'point'
    else 'line'
  end
$$;

create or replace function public.civil_geometry_matches(
  p_type public.civil_feature_type,
  p_geometry jsonb
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case public.civil_geometry_kind(p_type)
    when 'polygon' then (p_geometry->>'type') in ('Polygon','MultiPolygon')
    when 'line' then (p_geometry->>'type') in ('LineString','MultiLineString')
    else (p_geometry->>'type') = 'Point'
  end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'civil_features_geometry_kind_chk'
      and conrelid = 'public.civil_features'::regclass
  ) then
    -- Legacy rows created before this rule are normalised out of the way first.
    update public.civil_features
      set feature_type = 'grading_zone'
      where not public.civil_geometry_matches(feature_type, geometry)
        and (geometry->>'type') in ('Polygon','MultiPolygon');
    delete from public.civil_features
      where not public.civil_geometry_matches(feature_type, geometry);

    alter table public.civil_features
      add constraint civil_features_geometry_kind_chk
      check (public.civil_geometry_matches(feature_type, geometry));
  end if;
end $$;

revoke all on function public.civil_geometry_kind(public.civil_feature_type) from anon, authenticated;
revoke all on function public.civil_geometry_matches(public.civil_feature_type, jsonb) from anon, authenticated;
grant execute on function public.civil_geometry_kind(public.civil_feature_type) to service_role;
grant execute on function public.civil_geometry_matches(public.civil_feature_type, jsonb) to service_role;