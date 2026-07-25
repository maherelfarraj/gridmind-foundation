-- P-135 — bucket status helper for /api/cron/storage-check.
create or replace function public.list_storage_buckets_status(_ids text[])
returns table(id text, name text, is_public boolean)
language sql
security definer
set search_path = public, storage
as $$
  select b.id::text, b.name::text, b.public as is_public
  from storage.buckets b
  where b.id = any(_ids);
$$;

revoke all on function public.list_storage_buckets_status(text[]) from public, authenticated, anon;
grant execute on function public.list_storage_buckets_status(text[]) to service_role;

comment on function public.list_storage_buckets_status(text[]) is
  'P-135: existence + public flag for given storage buckets. service_role only.';
