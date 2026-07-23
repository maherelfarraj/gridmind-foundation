drop table if exists public.audit_log_retention_policies;
drop table if exists public.audit_logs;
drop function if exists public.write_audit_log(text, text, uuid, jsonb);