DROP FUNCTION IF EXISTS public.admin_get_slow_queries();
DROP FUNCTION IF EXISTS public.admin_get_db_health();
DROP FUNCTION IF EXISTS public.admin_get_table_sizes();

CREATE OR REPLACE FUNCTION public.admin_get_slow_queries()
RETURNS TABLE(
  query text,
  calls bigint,
  mean_ms numeric,
  total_ms numeric,
  max_ms numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEFT(s.query, 200) AS query,
         s.calls,
         ROUND(s.mean_exec_time::numeric, 2) AS mean_ms,
         ROUND(s.total_exec_time::numeric, 2) AS total_ms,
         ROUND(s.max_exec_time::numeric, 2) AS max_ms
  FROM extensions.pg_stat_statements s
  WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND s.query NOT LIKE '%pg_stat_statements%'
  ORDER BY s.total_exec_time DESC
  LIMIT 10;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_db_health()
RETURNS TABLE(
  connections_used bigint,
  connections_max integer,
  db_size_mb numeric,
  wal_size_mb numeric,
  xact_commit bigint,
  xact_rollback bigint,
  rollback_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM pg_stat_activity) AS connections_used,
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS connections_max,
    ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 2) AS db_size_mb,
    ROUND(
      (SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'pg_wal') / 1024.0 / 1024.0,
      2
    ) AS wal_size_mb,
    d.xact_commit,
    d.xact_rollback,
    CASE WHEN d.xact_commit + d.xact_rollback > 0
      THEN ROUND((d.xact_rollback::numeric / (d.xact_commit + d.xact_rollback)) * 100, 2)
      ELSE 0
    END AS rollback_rate
  FROM pg_stat_database d
  WHERE d.datname = current_database();
$$;

CREATE OR REPLACE FUNCTION public.admin_get_table_sizes()
RETURNS TABLE(
  schema_name text,
  table_name text,
  total_mb numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.nspname::text AS schema_name,
         c.relname::text AS table_name,
         ROUND(pg_total_relation_size(c.oid) / 1024.0 / 1024.0, 2) AS total_mb
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  ORDER BY pg_total_relation_size(c.oid) DESC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_slow_queries() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_db_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_table_sizes() TO service_role;
