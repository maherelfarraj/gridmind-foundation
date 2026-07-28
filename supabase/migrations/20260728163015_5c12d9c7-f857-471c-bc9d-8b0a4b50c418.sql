ALTER FUNCTION public.fixture_purge_tenants(uuid[]) SET statement_timeout = '240s';
ALTER FUNCTION public.fixture_purge_tenants(uuid[]) SET lock_timeout = '30s';