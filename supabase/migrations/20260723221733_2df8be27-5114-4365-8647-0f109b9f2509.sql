create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_updated_at on public.companies;
create trigger trg_updated_at before update on public.companies for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.profiles;
create trigger trg_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.user_roles;
create trigger trg_updated_at before update on public.user_roles for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.audit_log_retention_policies;
create trigger trg_updated_at before update on public.audit_log_retention_policies for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.module_access_rules;
create trigger trg_updated_at before update on public.module_access_rules for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.invites;
create trigger trg_updated_at before update on public.invites for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.api_keys;
create trigger trg_updated_at before update on public.api_keys for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.webhook_endpoints;
create trigger trg_updated_at before update on public.webhook_endpoints for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at on public.webhook_deliveries;
create trigger trg_updated_at before update on public.webhook_deliveries for each row execute function public.set_updated_at();