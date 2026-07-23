## Drop tenancy, audit, and module-gating tables

Destructive migration that removes six tables from `public`. This wipes all data in them and drops dependent objects.

### Tables dropped (with CASCADE where needed)
- `public.module_access_rules`
- `public.audit_log_retention_policies`
- `public.audit_logs`
- `public.user_roles`
- `public.profiles` (CASCADE)
- `public.companies` (CASCADE)

### Expected collateral damage from CASCADE
Dropping `profiles` and `companies` will cascade to anything referencing them, including:
- FKs on `invites`, `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `fx_rates`, `currencies` (any `company_id` / `invited_by` / `accepted_by` FKs) — the referencing columns' FK constraints get dropped; the tables themselves remain but become orphaned.
- The `handle_new_user()` trigger on `auth.users` will fail on next signup because it inserts into `public.profiles`.
- RLS helper functions (`has_role`, `is_company_member`, `has_company_role`, `is_company_admin`, `has_module_access`, `assert_can_grant_role`, `write_audit_log`, `create_invite`, `redeem_invite`) will still exist but reference missing tables and error at runtime.
- Every RLS policy on remaining tables that calls those helpers will deny access (helper raises), effectively bricking the app's data layer.
- App routes under `_authenticated/`, AppShell, invites flow, and auth signup will break.

### Questions before I write the migration
1. Are you intentionally resetting the tenancy layer to rebuild it from scratch? If yes, do you also want me to drop the dependent tables (`invites`, `api_keys`, `webhook_*`, `fx_rates`, `currencies`) and the helper functions/trigger in the same migration to leave a clean slate?
2. Or is this only meant as a temporary teardown, and you'll re-apply migrations 0001–0007 right after?

I won't apply anything until you confirm scope — a bare drop as written will leave the database in a broken half-state.
