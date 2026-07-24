## P-036 — Wizard step 4: team assignment + `createProject`

### New server functions (`src/lib/projects.functions.ts`)

1. `listEligibleUsers({ companyId, role })`
   - `requireSupabaseAuth` + zod (`role: app_role` enum, `companyId: uuid`).
   - Query `profiles` for the company, left-join `user_roles` filtered by role (or query `user_roles` and join). Returns `{ id, full_name, email, hasRole }[]` sorted by name. Uses caller's authenticated Supabase client (RLS enforces same-company).
   - Callers: project-admin picker (`project_admin`), 5 dept-lead pickers (`engineering_admin`, `procurement_admin`, `construction_admin`, `hse_admin`, `finance_admin`).

2. `listCompanyMembers({ companyId })`
   - Same auth pattern. Returns full profile list (id, full_name, email) for the members multi-select.

3. `createProject(input)` — the big one.
   - **Input (zod):** `projectBasicsSchema(archetype)` fields + `{ companyId, archetype, template_id: uuid|null, project_admin_id: uuid, member_ids: uuid[], dept_leads: Record<department, uuid> }`.
   - **Auth gate:** `requireSupabaseAuth`, then `context.supabase.rpc('has_company_role', { p_role: 'company_admin' })` OR `('project_admin')`; throw 403 otherwise.
   - **Green H₂ gate:** if `archetype === 'green_hydrogen'`, `rpc('has_module_access', { p_company_id, p_module: 'green_hydrogen' })`; throw 403 otherwise.
   - **Template load (when template_id):** re-fetch template from DB (don't trust client), parse `default_gates`/`default_departments` with existing zod. If null, use fallbacks.
   - **Ordered inserts (abort on first error, no wrapping tx — Supabase Data API can't do multi-statement tx, but each insert is atomic and code becomes visible only via the final navigate; unique(company_id, code) is the double-submit backstop):**
     1. `projects` — phase `development`, status `active`, `created_by = userId`, `project_admin_id`, `template_id`, all basics fields. Capture returned `id`.
     2. `project_members` — admin row `project_role='admin'`; then all `member_ids` minus admin as `'member'` (dedupe). `created_by = userId`.
     3. `project_departments` — from `template.default_departments` (or the 5 standard: engineering/procurement/construction/hse/finance if template null / empty), one row per dept, `lead_user_id = dept_leads[dept] ?? null`, status `'not_started'`.
     4. `project_phase_gates` — **one row per phase** (unique constraint is `(project_id, phase)`), 4 rows for phases `development, ntp, cod, handover`, `sort_order` 1–4, name = phase label (`Development`, `NTP`, `CoD`, `Handover`), `checklist` = template items filtered by that phase (in `sort_order`) or `[]` for blank. Status `'open'` for `development`, `'locked'` for the rest.
   - **Audit:** `rpc('write_audit_log', { p_action:'project.created', p_entity:'projects', p_entity_id: project.id, p_metadata: { archetype, template_id, member_count } })`.
   - **Return:** `{ id, code }`.

### New component: `src/components/wizard/team-form.tsx`

- Sections in order: Project admin (required) → Members (multi) → Department leads (5 pickers).
- Project admin: shadcn `Select` populated from `listEligibleUsers('project_admin')`. Empty state renders helper text with a link to `/settings/users` and disables the Finish button. Helper text under label: *"A project_admin is required before departments can start work"*.
- Members: search input + checkbox list built from `listCompanyMembers`. When `project_admin_id` set, that user is force-checked & disabled ("Project admin — always a member" caption).
- Department leads: 5 `Select`s side-by-side (Engineering/Procurement/Construction/HSE/Finance). Each maps to its `_admin` role query. Empty options render "No users hold this role — assign later" placeholder; empty selection is allowed.
- All queries with `useQuery`, per-role `queryKey`, `enabled: !!activeCompanyId`.
- All colors via semantic tokens.

### Route: `src/routes/_authenticated/projects.new.tsx` (step 4 branch)

- Replace "Coming soon" card with `<TeamForm>` gated on `hydrated && draft.archetype && draft.basics && draft.selection && activeCompanyId`. If any missing, redirect to earliest incomplete step (already handled for step ≥ 2; extend for 3 and 4).
- Submit handler (`useServerFn(createProject)` + `useMutation`):
  - Builds the zod-validated payload from draft + form.
  - On success: `toast.success("Project created")`, `clearDraft()`, `navigate({ to: '/projects/$projectId', params: { projectId: id } })`.
  - On error: `toast.error(msg)` + inline `<WizardErrorPanel>`; keep draft.
- Finish button disabled while pending, spinner icon; disabled until `project_admin_id` set. Double-submit backstop = mutation `isPending` + unique(company_id, code).

### Placeholder detail route: `src/routes/_authenticated/projects.$projectId.tsx`

- Minimal skeleton so navigation on success lands somewhere real. Fetches project name/code/phase for header via new lightweight `getProjectSummary({ id })` server fn (also useful for P-037/P-038). Content body: "Project cockpit ships in P-038." Full `head()` metadata.

### Tests (`tests/unit/`)

- `create-project-schema.test.ts` — validates the composed input schema: rejects missing `project_admin_id`, rejects malformed uuid in members, MWh gating still enforced for BESS.

### Verification checklist (run after ship)

1. Typecheck + unit tests pass.
2. Playwright: log in as `demo-admin`, ensure they have `project_admin` role via `/settings/users` first (SQL-verify in the same run).
3. Create "Prairie Winds Solar — 150 MWac", Utility PV, 150 MW, pick the system template, add 1+ member, assign finance lead.
4. Post-create DB check (psql):
   - exactly 1 `projects` row for the code
   - `project_members` ≥ 2, one with `project_role='admin'` = the project_admin
   - 5 `project_departments` rows (matches template default)
   - 4 `project_phase_gates` rows, `development.status='open'`, others `'locked'`, checklists populated from template
   - exactly 1 `audit_logs` row with `action='project.created'` for that project id
5. Double-click Finish: verify only one project row (idempotency via `isPending` + unique code backstop returning a friendly toast).
6. URL lands on `/projects/<uuid>`; placeholder renders.

## Notes / deliberate scope

- No cross-statement transaction: Supabase Data API doesn't expose one. Ordering + unique constraint is the intended backstop, matching every prior wizard batch. If a mid-pipeline insert fails, we surface the error and leave the partial project in place (audit trail keeps `project.created` from firing since it's last).
- Green H₂ archetype: server re-checks `has_module_access` (belt-and-braces after step 1's gate).
- Dept-lead select values: user IDs. If a lead is picked but the user isn't already a member, they're auto-added as a `'member'` project_members row before the departments insert (safer than orphan `lead_user_id`).
