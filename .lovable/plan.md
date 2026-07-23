## Batch 02 verification status

Ran read-only checks against the demo company.

### Passing
- **Module rows for demo company: 9** ✓
- **`green_hydrogen` override enabled: true** ✓ (plan_tier `enterprise` + override → `has_module_access` returns true by definition; the function itself couldn't be invoked via the read-only runner due to EXECUTE grants, but its inputs are verified)
- **Retention `financial` = 2555** ✓ (also confirmed `default` = 400)
- **Seed idempotency**: counts are stable (9 modules, 2 retention rows, 6 currencies) — re-runs produce no duplicates

### Blocking
- **Demo admin not linked yet**: `public.profiles` has no row for `demo-admin@gridmindepc.com` and `public.user_roles` returns no rows for that email. Seed step 5 has not run successfully against a real auth user.

### What to do
1. In Preview, sign up `demo-admin@gridmindepc.com` (any password; confirm email if prompted).
2. Tell me "Re-run supabase/seed.sql" — I'll execute step 5 to insert the profile + `company_admin` + `super_admin` rows scoped to Demo EPC Co.
3. Log in as the demo admin in Preview and confirm the sidebar shows all modules including Admin and Green H₂.

No file or schema changes needed — this is purely waiting on the signup, then a data insert.
