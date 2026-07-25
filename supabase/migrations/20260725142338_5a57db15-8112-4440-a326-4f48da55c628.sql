-- P-135 — helper for /api/cron/storage-check to read policy names on
-- storage.objects without granting broad catalog access.
create or replace function public.list_storage_object_policies()
returns table(policyname text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select p.policyname::text
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects';
$$;

revoke all on function public.list_storage_object_policies() from public, authenticated, anon;
grant execute on function public.list_storage_object_policies() to service_role;

comment on function public.list_storage_object_policies() is
  'P-135: names of RLS policies on storage.objects. service_role only.';
