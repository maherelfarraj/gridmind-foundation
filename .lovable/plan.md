## P-031 — Projects core migration

Apply migration `supabase/migrations/0012_projects_core.sql` with the exact SQL from the request (4 enums, 4 tables, RLS, policies, grants, indexes, triggers, audit function). Then verify and regenerate types.

### Steps

1. Apply `0012_projects_core.sql` via the migration tool, verbatim from the request. If any statement errors, stop and surface the exact error + statement (per standing rule; may need `drop type ... cascade` and re-run rather than hand-patching).
2. Regenerate `src/integrations/supabase/types.ts` (auto after migration approval).
3. Verify with read queries and show results:
   - 4 enums exist (`project_archetype`, `project_phase`, `project_status`, `project_department`).
   - 4 tables exist with expected columns.
   - RLS enabled on all 4; policies listed (`*_select`, `*_admin`, plus `departments_lead_update`).
   - `authenticated` grants present on all 4.
   - Indexes present (`idx_projects_phase`, `idx_project_members_project/user`, `idx_project_departments_project`, `idx_phase_gates_project`, plus per-table `idx_<t>_company`).
   - Triggers present: `trg_<t>_updated` on all 4, `trg_gate_audit`, `trg_project_phase_audit`.
   - `unique(company_id, code)` on projects; `unique(project_id, phase)` on project_phase_gates.
4. Behavioral checks via read/insert queries against seed data:
   - Cross-tenant SELECT isolation (Test Co B member cannot see Demo EPC Co projects) — validate via policy definitions since we can't impersonate; note this is policy-level verification.
   - Confirm plain-member INSERT policy denial (policy USING clause requires `company_admin` or `project_admin`).
   - Insert a projects row as Demo EPC Co, insert a phase_gate row, UPDATE its status, confirm exactly one `audit_logs` row with `from`/`to` metadata.

### Notes

- No app code (routes, RPCs, components) in this task — migration + verification only.
- `template_id` / `approval_instance_id` FKs deferred to P-032 / P-040 as specified.
- After success, prompt user to say `next` for P-032.
