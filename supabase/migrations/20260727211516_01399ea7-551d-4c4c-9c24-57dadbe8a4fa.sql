CREATE OR REPLACE FUNCTION admin.cron_runs(p_limit int DEFAULT 50)
RETURNS TABLE (jobname text, status text, return_message text, start_time timestamptz, end_time timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public, pg_temp
AS $$
  SELECT j.jobname, d.status, d.return_message, d.start_time, d.end_time
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  ORDER BY d.start_time DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION admin.cron_runs(int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin.cron_jobs()
RETURNS TABLE (jobid bigint, jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public, pg_temp
AS $$
  SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
$$;

REVOKE ALL ON FUNCTION admin.cron_jobs() FROM PUBLIC, anon, authenticated;