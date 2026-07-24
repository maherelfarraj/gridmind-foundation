## Current state (verified via psql)

`public.companies` contains exactly two rows — no `Demo EPC Co.` (period) duplicate:

| name | slug | plan_tier |
|---|---|---|
| Demo EPC Co | demo | enterprise |
| test-co-b | test-co-b | growth |

So there is nothing to delete: no duplicate company, no orphan `profiles` / `user_roles` / `projects` / `invites` / `module_access_rules` / `audit_log_retention_policies` rows to clean up.

Heads-up: the second company's `name` column is `test-co-b`, not `Test Co B` as your acceptance list expects. Slug matches. I'll leave the name alone unless you ask me to rename it (a one-line `UPDATE` migration).

## The real fix — stale seed migration

`rg` found exactly one file still referencing the bad name:

- `supabase/migrations/20260724113707_ce48c97c-da5e-419d-9584-8e87d5cc62c8.sql`
  - Line 1 comment: `-- P-035: seed system project templates for Demo EPC Co.`
  - Line 4 lookup: `SELECT id FROM public.companies WHERE name = 'Demo EPC Co.' LIMIT 1`

That `name = 'Demo EPC Co.'` is why the original P-035 seed silently inserted zero rows (the actual name has no period). I'll swap it to a slug-based lookup so a future re-run can't miss the tenant or accidentally recreate a duplicate.

## Changes

1. Edit `supabase/migrations/20260724113707_ce48c97c-da5e-419d-9584-8e87d5cc62c8.sql`:
   - Comment → `-- P-035: seed system project templates for the Demo tenant (slug='demo').`
   - CTE → `SELECT id FROM public.companies WHERE slug = 'demo' LIMIT 1`
2. Re-run `rg "Demo EPC Co\."` to confirm zero remaining hits.
3. Re-run the `companies` select and paste it back so you can confirm the final list.

No DB migration required — the file is a historical migration that already ran; editing its text prevents a bad re-run without changing current DB state.
