## P-032 — Templates + archetype config tables

Apply migration `supabase/migrations/0013_templates_archetypes.sql` verbatim from the request (1 template table + 9 archetype 1:1 config tables, projects.template_id FK, RLS/policies/grants/indexes/triggers, plus extra finance_admin policy on the financial config).

### Steps

1. Apply the migration via the migration tool. Add `::app_role` casts on the `has_company_role(...)` calls inside the DO block for enum literal safety (same pattern used in 0012). Include `grant all ... to service_role` on all 10 new tables. If any statement errors, stop and surface it.
2. Verify with read queries and show:
   - 10 new tables exist; RLS enabled on all.
   - `projects.template_id` FK → `project_templates(id)` present.
   - Policies present per table (`<t>_select`, `<t>_write`), plus `project_financial_config_fin`.
   - `unique(project_id)` on the 9 config tables; `unique(company_id, name, archetype)` on templates.
3. Behavioral checks:
   - Insert a template + project referencing it (FK works).
   - Attempt a second `project_pv_config` row for the same `project_id` → expect unique-violation.
   - Clean up test rows.

Types file regenerates automatically after approval.
