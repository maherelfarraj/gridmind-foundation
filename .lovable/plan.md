## P-093 — Commissioning Core (tests, performance, punch signoffs) + Test Board

### 1. Migration `supabase/migrations/0045_commissioning_core.sql`

Run the exact SQL provided in the spec:
- Enums (guarded): `commissioning_test_type`, `commissioning_test_status`
- Tables: `commissioning_tests`, `performance_tests`, `punch_signoffs` (with `unique(punch_item_id, signoff_party)`)
- Standard tenant columns + `set_updated_at()` triggers
- RLS enabled; SELECT via `is_company_member`, writes gated by role sets per table
- Explicit GRANTs to `authenticated` (no DELETE on performance_tests / punch_signoffs)
- Indexes as specified

File number will be `0045_*` since `0044_*` is already used by NCR/submittals/transmittals. Types regenerate automatically after migration approval.

### 2. Server functions — `src/lib/commissioning.functions.ts`

- `listCommissioningTests({ projectId, testType?, status?, area?, search? })` — `requireSupabaseAuth`, server-filtered.
- `assignCommissioningTests({ projectId, area, testTypes[], equipmentRef?, stringRef?, assignedTo?, plannedDate?, utilityWitnessRequired })` — zod validated. Bulk insert one row per selected type; emit `writeAuditLog('commissioning.test_assigned', 'commissioning_tests', id, {test_type, area, assigned_to})` per row.
- Role gate in handler: construction_admin | company_admin | project_admin | engineer | foreman | field_technician (matches RLS write policy).

### 3. UI route — `src/routes/_authenticated/projects/$projectId/commissioning/index.tsx`

- Header: project name, "Assign tests" button (edit roles only), CSV export.
- Filter chips row: IR, Hipot, IV Curve, String Test, Continuity, Earth Resistance, Functional; plus search input; status filter.
- Body: tests grouped by `area` into collapsible sections. Each section shows per-status counts (not_started → passed/failed) and a table of tests (type, equipment/string, assignee, planned date, status badge, witness flag).
- States: skeleton loader, empty ("No commissioning tests assigned yet"), error with retry.
- "Assign tests" dialog: react-hook-form + zod resolver. Fields: area (text), test types (multi-select checkboxes), equipment ref, string ref, assignee (select from project_members), planned date, utility witness required (switch). Submit → `assignCommissioningTests` mutation → invalidate list, toast, close.
- Semantic tokens only; use existing shadcn primitives (Dialog, Card, Badge, Table, Button, Checkbox, Switch, Skeleton).

### 4. Nav + linkage

Add "Commissioning" link on the project cockpit sidebar (`src/lib/nav-map.ts` and project layout) visible to read roles: om_admin, company_admin, client_viewer, plus all edit roles.

### 5. Verification checklist

- Run migration; re-run to confirm idempotency (enums guarded, `if not exists`, triggers via dynamic block — will need `drop trigger if exists` before create to be truly re-runnable → **add `drop trigger if exists` in the do-block loop** so second run stays clean.
- `SELECT relrowsecurity` on all 3 tables = true.
- Cross-tenant SELECT returns 0.
- Assign IR+Hipot+IV+string for "Array Block 1" with witness ON for Hipot → 4 rows, 4 audit entries.
- Duplicate `(punch_item_id, signoff_party)` insert rejected.
- client_viewer can list, `assignCommissioningTests` returns 403.

### Technical notes

- Migration file name: `0045_commissioning_core.sql` (0044 is taken).
- Trigger creation loop needs `drop trigger if exists trg_<t>_updated on public.<t>` before `create trigger` for idempotency; adding this is the only deviation from the pasted SQL.
- Audit log helper: existing `writeAuditLog` server helper (per prior migrations).
- Roles reference the existing `app_role` enum values used elsewhere (construction_admin, foreman, field_technician, engineer, project_admin, company_admin, om_admin, client_viewer).
