# P-088 — HSE module (incidents, inspections, training) + 24h rule + TRIR

## 1. Migration `supabase/migrations/0041_hse.sql`
Executes the SQL exactly as specified in the ticket:
- 4 enums (`hse_incident_type`, `hse_incident_severity`, `hse_incident_status`, `hse_inspection_status`) inside guarded `do $$ … duplicate_object` blocks
- 3 tables (`hse_incidents`, `hse_inspections`, `hse_training_records`) with `company_id`/`project_id` FKs, `corrective_actions`/`checklist` jsonb defaults
- `unique (company_id, incident_number)` on incidents
- RLS enabled + policies:
  - `hse_incidents`: select = member; insert = member + (hse_admin | construction_admin | foreman | field_technician | company_admin); update = member + (hse_admin | construction_admin | company_admin)
  - `hse_inspections` and `hse_training_records`: select = member; FOR ALL write = member + (hse_admin | company_admin)
- Grants: `select` on all three to authenticated; `insert, update` on incidents; `insert, update` on inspections & training (no DELETE grants, per house rules)
- `service_role` = ALL on the three tables
- Indexes: `incidents_project_status_idx`, `inspections_project_idx`, `training_expiry_idx`
- `trg_updated_at` BEFORE UPDATE trigger on each table using existing `public.set_updated_at()`

## 2. Rules module `src/lib/hse.rules.ts`
Pure, unit-testable helpers:
- Zod schemas: `incidentInput`, `incidentUpdateInput`, `incidentCloseInput`, `correctiveActionSchema`, `inspectionInput`, `inspectionChecklistItem`, `trainingInput`
- 24-hour helpers:
  - `hoursSinceOccurred(occurredAt, now)`
  - `is24hCountdown(occurredAt, reportedAt, now)` → returns `{ kind: 'countdown', hoursRemaining }` when `now - occurredAt < 24h` AND `reported_at - occurred_at < 24h`
  - `is24hLate(occurredAt, reportedAt)` → `reported_at - occurred_at > 24h`
- `computeTrir(recordables, hours)` → hours ≤ 0 returns `null`; else `(recordables * 200000) / hours`
- `summarizeChecklist(items)` → `{ findingsCount, openFindings }` (fail = finding; open until `notes` field marks resolved — spec ties findings_count to fail count, open_findings = fails without a `resolved` marker in item)
- `trainingCertBadge(expiresOn, now)` → `expired | expiring_30 | valid`
- `nextIncidentNumber(existing, prefix='HSE-')` → next `HSE-####` from max existing

## 3. Server functions `src/lib/hse.functions.ts`
All wrap `createServerFn({ method })` + `requireSupabaseAuth` + zod; audit via existing `write_audit_log` RPC.
- `listIncidents({ projectId?, status?, search?, from?, to? })`, `getIncident({ id })`
- `createIncident(incidentInput)`:
  - resolves `company_id` from project, requires role via RLS
  - allocates `incident_number` (`HSE-{seq(4)}`) — retry on `23505` up to 5×
  - `writeAuditLog('hse.incident_create', 'hse_incidents', id, {…})`
- `updateIncident(incidentUpdateInput)` → `hse.incident_update`
- `closeIncident({ id, closingNotes? })` → sets status=closed, closed_by=auth.uid(), closed_at=now(); audit `hse.incident_close`
- `listInspections`, `getInspection`, `upsertInspection` (recomputes findings_count/open_findings from checklist), `closeInspection`
- `listTraining`, `upsertTrainingRecord`, `signTrainingCert({ paths })` → signed URLs from `documents` bucket
- `getHseDashboard({ projectId?, days=30 })` → runs 5 parallel queries:
  1. Open incidents count
  2. Incidents currently inside their unlogged 24h window (`reported_at is null OR reported_at - occurred_at < interval '24 hours'`) — since `reported_at` defaults to now(), "inside window" = `now() - occurred_at < 24h AND reported_at - occurred_at < 24h`
  3. Inspections this month
  4. Training expiring in 30 days
  5. TRIR = `(count(*) filter (where osha_recordable) over trailing 12 months) * 200000 / sum(hours from manpower_logs over trailing 12 months)` — hours pulled via a second query joining `manpower_logs` filtered by company/project + date range
- All read functions accept optional `projectId` filter and scope by `is_company_member` via RLS

## 4. Nav + routes
Add "HSE" section in `src/lib/nav-map.ts` under Field group (icon: HardHat/Shield) with children Dashboard, Incidents, Inspections, Training.

New routes (all under `src/routes/_authenticated/`, TanStack Query pattern with `queryOptions` + `useSuspenseQuery`, skeleton + empty + error states, semantic tokens only):
- `hse.index.tsx` → `/hse` — dashboard
  - Amber `bg-warning/10` banner: "N incident(s) inside the 24h logging window"
  - 5 KPI tiles: TRIR (12m), Open incidents, Overdue 24h logs, Inspections this month, Training expiring in 30 days
  - TRIR shows "—" when hours=0 with `Tooltip` explaining "Add manpower hours to compute TRIR"
  - Recent incidents list with countdown / "Logged late" badges
- `hse.incidents.tsx` → `/hse/incidents` — list + search + status filter + CSV export
- `hse.incidents.new.tsx` → `/hse/incidents/new` — form with info banner "Incidents must be logged within 24 hours of occurrence."; fields per schema; OSHA-recordable toggle; corrective-actions repeater
- `hse.incidents.$id.tsx` → `/hse/incidents/$id` — detail with edit/close (role-gated in UI), corrective-actions editor, badge state
- `hse.inspections.tsx` → `/hse/inspections` — list + "New inspection" dialog + checklist runner sheet with pass/fail/na per item; auto-computed findings tally on save
- `hse.training.tsx` → `/hse/training` — list with expiry badges; add-record dialog with certificate upload to `documents` bucket at `{company_id}/hse/training/{recordId}-{filename}`

## 5. Shared UI bits
- `src/components/hse/incident-badge.tsx` — renders `countdown` / `late` / `on_time` badges via `hse.rules.ts` helpers
- `src/components/hse/checklist-runner.tsx` — pass/fail/na radio row per item, notes field, live findings counter
- `src/components/hse/training-expiry-badge.tsx` — expired / expiring / valid variants

## 6. Tests
- `tests/unit/hse-rules.test.ts` covers:
  - `computeTrir` — normal, zero-hours (null), negative hours (null)
  - `hoursSinceOccurred`, `is24hCountdown`, `is24hLate` — boundary at 24h (23.9, 24.1, exactly 24)
  - `summarizeChecklist` — fail counts, na ignored
  - `trainingCertBadge` — expired / 29 days / 31 days
  - `nextIncidentNumber` — empty → HSE-0001; existing max → +1 padded
- `tests/rls/hse.rls.test.ts` (stub, matching P-083 pattern):
  - anon SELECT/INSERT blocked
  - member SELECT ok; cross-company SELECT blocked
  - foreman INSERT incident ok; foreman UPDATE incident blocked
  - hse_admin UPDATE ok, DELETE blocked (no grant)
  - inspections/training INSERT blocked for foreman

## 7. Acceptance walkthrough
- `bun test:unit hse-rules` green
- Migration twice clean (guarded enums, `if not exists` tables/indexes)
- Manual: incident at −30h → red "Logged late"; incident at −2h → "Log within 24h — 22h remaining"; dashboard banner counts window incidents; TRIR shows recordables×200k/hours (— when no hours)
- Cross-tenant read = 0 (RLS)

## Notes for reviewer
- Not touching the existing DPR/manpower schema — TRIR pulls existing `manpower_logs.hours` directly.
- No DELETE grants; matches project-wide convention.
- Cert uploads go to the existing `documents` bucket; no new bucket needed.
- Following stack rules: no Edge Functions, only `createServerFn`; auth attacher already registered in `src/start.ts`.
