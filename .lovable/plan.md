## Drive the P-036 wizard end-to-end, then verify

I'll script Playwright against the local preview to run the full 4-step wizard as the signed-in demo admin, then run the 5 verification SQL queries and report the results.

### Steps

1. **Preflight checks (SQL, read-only)**
   - Confirm at least one user in the Demo EPC Co tenant holds `project_admin` (needed for step 4). If none, stop and ask before proceeding — I won't grant roles without confirmation.
   - Note the caller's `user_id` and any `finance_admin` candidates so the wizard fills correctly.

2. **Playwright script (`/tmp/browser/p036/`)**
   - Restore the injected Supabase session (`LOVABLE_BROWSER_SUPABASE_*`) into localStorage + cookies, navigate to `http://localhost:8080/projects/new`.
   - Step 1: click the **Utility PV** card → Next.
   - Step 2: fill name `Prairie Winds Solar — 150 MWac`, code `PWS-2026`, capacity `150`, site name `Ma'an Solar Park`, country `Jordan`, region `Ma'an Governorate`, offtaker `NEPCO`, target COD `2027-12-31` → Next.
   - Step 3: pick the **Utility PV** system template → Next.
   - Step 4: select project admin (self), pick finance lead from the eligible list, leave other dept leads blank → Finish.
   - Screenshot each step and wait for navigation to `/projects/<uuid>`; capture the final URL and toast.

3. **Verification queries (after wizard completes)**
   Bind the new `project_id` from the URL, then run:
   1. `SELECT * FROM projects WHERE id = $1` — full row.
   2. `SELECT project_role, count(*) FROM project_members WHERE project_id = $1 GROUP BY project_role`.
   3. `SELECT department, lead_user_id, status FROM project_departments WHERE project_id = $1 ORDER BY department` — expect 5 rows.
   4. `SELECT phase, name, status, sort_order FROM project_phase_gates WHERE project_id = $1 ORDER BY sort_order` — expect Development=open, others=locked.
   5. `SELECT action, entity, entity_id, metadata, created_at FROM audit_logs WHERE entity='projects' AND entity_id=$1 AND action='project.created'` — expect exactly 1 row.

4. **Report** — inline table of results + pass/fail against the expected shape, plus links to screenshots. If the wizard errors, I stop and surface the toast + console/network output rather than fabricating data.

### No code changes

This is verification-only — no file edits, no migrations, no data inserts.
