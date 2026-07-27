-- P-135 — Admin performance/capacity cockpit RPCs. All SECURITY DEFINER, granted
-- to service_role only (called from supabaseAdmin inside super_admin-gated
-- server functions). No PII; read-only introspection of Postgres stats.

create extension if not exists pg_stat_statements;

-- Top slow queries by mean execution time.
create or replace function public.admin_get_slow_queries()
returns table (
  query text,
  calls bigint,
  mean_ms double precision,
  total_ms double precision,
  max_ms double precision
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    left(regexp_replace(s.query, '\s+', ' ', 'g'), 300) as query,
    s.calls,
    round(s.mean_exec_time::numeric, 2)::double precision as mean_ms,
    round(s.total_exec_time::numeric, 2)::double precision as total_ms,
    round(s.max_exec_time::numeric, 2)::double precision as max_ms
  from pg_stat_statements s
  join pg_database d on d.oid = s.dbid
  where d.datname = current_database()
  order by s.mean_exec_time desc
  limit 10;
$$;

revoke all on function public.admin_get_slow_queries() from public, anon, authenticated;
grant execute on function public.admin_get_slow_queries() to service_role;

-- Aggregate DB health: memory/disk are best-effort (not always exposed by
-- managed Postgres), connections/wal/rollback rate come from pg_stat_database.
create or replace function public.admin_get_db_health()
returns table (
  connections_used integer,
  connections_max integer,
  db_size_mb double precision,
  wal_size_mb double precision,
  xact_commit bigint,
  xact_rollback bigint,
  rollback_rate double precision
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    (select count(*)::integer from pg_stat_activity) as connections_used,
    (select setting::integer from pg_settings where name = 'max_connections') as connections_max,
    round((pg_database_size(current_database()) / 1024.0 / 1024.0)::numeric, 2)::double precision as db_size_mb,
    round((coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'), 0) / 1024.0 / 1024.0)::numeric, 2)::double precision as wal_size_mb,
    d.xact_commit,
    d.xact_rollback,
    case when (d.xact_commit + d.xact_rollback) > 0
      then round((d.xact_rollback::numeric / (d.xact_commit + d.xact_rollback)) * 100, 3)::double precision
      else 0
    end as rollback_rate
  from pg_stat_database d
  where d.datname = current_database();
$$;

revoke all on function public.admin_get_db_health() from public, anon, authenticated;
grant execute on function public.admin_get_db_health() to service_role;

-- Top tables by total size (table + indexes + toast).
create or replace function public.admin_get_table_sizes()
returns table (
  schema_name text,
  table_name text,
  total_bytes bigint,
  total_mb double precision
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    n.nspname::text as schema_name,
    c.relname::text as table_name,
    pg_total_relation_size(c.oid) as total_bytes,
    round((pg_total_relation_size(c.oid) / 1024.0 / 1024.0)::numeric, 2)::double precision as total_mb
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname = 'public'
  order by pg_total_relation_size(c.oid) desc
  limit 10;
$$;

revoke all on function public.admin_get_table_sizes() from public, anon, authenticated;
grant execute on function public.admin_get_table_sizes() to service_role;
