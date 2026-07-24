# P-056 — PVsyst / yield scenarios workspace

Multi-scenario yield modelling for a project with comparison charts and PVsyst report import, replacing today's 1:1 `project_yield_config` row.

## 1. Migration `0019_yield_scenarios.sql` (idempotent)

- `project_yield_config`
  - Add `scenario_name text not null default 'Base'`.
  - Add `results jsonb not null default '{}'` (holds `p50_mwh`, `p90_mwh`, `specific_yield_kwh_kwp`, `pr_pct`, `imported`).
  - Add `params jsonb not null default '{}'` (tilt_deg, azimuth_deg, gcr, tracking, bifacial, dc_ac_ratio, losses_pct breakdown).
  - Backfill existing rows: `scenario_name='Base'`; move existing scalar columns into `results` where present.
  - `alter table … drop constraint if exists project_yield_config_project_id_key`.
  - `create unique index if not exists project_yield_config_project_scenario_uniq on project_yield_config(project_id, scenario_name)`.
- `project_pvsyst_config`
  - Same treatment: add `scenario_name text not null default 'Base'`, `params jsonb`, drop old unique on `project_id`, add composite unique on `(project_id, scenario_name)`.
- Keep existing RLS policies and `set_updated_at` triggers (they already cover the new columns).
- No new GRANTs needed — table already granted in original migration.

## 2. P-045 call-site update

In `src/lib/proposal.functions.ts` (`runYieldStub`), change the `project_yield_config` upsert to:
- Include `scenario_name: 'Proposal'` and `onConflict: 'project_id,scenario_name'`.
- Move scalar fields into a `results` jsonb payload as well, keeping the legacy columns for back-compat until later cleanup. This preserves the proposal → project flow under the new composite unique.

## 3. Server functions — `src/lib/yield.functions.ts` (new)

All `.middleware([requireSupabaseAuth])` and role-gated to `engineering_admin | engineer | project_admin` via `has_role` checks on `context.userId` before write. Reads open to any company member (RLS enforces).

- `listYieldScenarios({ projectId })` → rows joined with project MWp for KPI display.
- `saveYieldScenario({ projectId, id?, scenarioName, params })` — zod: tilt 0–90, azimuth 0–360, gcr 0.1–0.9, dc_ac_ratio 0.8–1.6, tracking enum, losses each 0–40 (%). Upserts on `(project_id, scenario_name)`. Writes audit `engineering.yield_scenario_saved` with changed fields.
- `estimateYieldScenario({ projectId, id }) ` — deterministic stub: uses `mulberry32` seeded by `projectId+scenarioName` from `src/lib/yield/stub.ts`, computes P50 from MWp × specific-yield baseline (1600 kWh/kWp) adjusted for tracking (+8%/+12%), tilt loss curve, GCR shading, losses total; P90 = P50 × 0.92; specific yield = P50_mwh×1000 / MWp; PR = 100 − losses_total. Writes into `results` plus `results.stub_version='gridmind-yield-stub-v1'`. Same audit event.
- `duplicateYieldScenario({ projectId, id, newName })`.
- `deleteYieldScenario({ projectId, id })` — blocks deletion of `'Proposal'` scenario (managed by proposal flow).
- `importPvsystScenario({ projectId, scenarioName, documentId, parsed })` — expects a `documents` bucket file already uploaded via existing site-data flow; parses provided `{ p50_mwh, p90_mwh, pr_pct, specific_yield_kwh_kwp }` (client-parsed for CSV; PDF path stores file only and records metrics from a small form), sets `results.imported=true`, `results.source_document_id`.
- `getEngineeringYieldKpi({ projectId })` — returns `{ scenarioCount, latestP50Mwh, baseP50Mwh }` for the KPI hook.

Parse logic lives in `src/lib/yield/pvsyst-parse.ts` (client-safe): CSV parser looks for header rows `P50`, `P90`, `PR`, `Specific yield`; PDF is stored only, metrics captured via form (avoids pulling a PDF parser into the Worker).

## 4. UI — `src/routes/_authenticated/projects.$projectId.engineering.yield.tsx`

Tabs (shadcn `Tabs`): **Scenarios**, **Comparison**, **PVsyst import**. Add "Yield" to the engineering sub-navigation.

- **Scenarios tab** (`components/engineering/yield-scenarios-table.tsx`)
  - `Table` with columns: name, tilt, GCR, tracking, DC/AC, P50 (MWh), P90 (MWh), specific yield, PR, actions (Edit / Duplicate / Run estimate / Delete).
  - Toolbar: "New scenario" opens `YieldScenarioDrawer` (react-hook-form + zod bound to params schema, sonner toasts, optimistic cache update via query invalidation).
  - Row "Run estimate" → calls `estimateYieldScenario`; result badge labelled **"Preliminary estimate — replace with PVsyst import"**.
  - Empty state: "Create your first scenario".
  - Skeleton + error-with-retry states.
- **Comparison tab** (`components/engineering/yield-comparison.tsx`)
  - Multi-select (2–4) scenarios; Recharts `BarChart` grouped P50/P90; second `BarChart` (stacked) for loss breakdown; delta column vs Base scenario (`(scenario.p50 − base.p50)/base.p50`).
- **PVsyst import tab** (`components/engineering/yield-pvsyst-import.tsx`)
  - Reuses existing `documents` bucket upload flow (`src/lib/site-data.functions.ts`) with `category='engineering'`, `metadata.subtype='pvsyst_report'`.
  - After upload, form captures parsed / entered metrics → `importPvsystScenario` → row appears in Scenarios with an "Imported" badge.

Design tokens only; no raw colors. Role-gated writes: readers see disabled action buttons + tooltip.

## 5. KPI hook

`src/lib/hooks/use-engineering-yield-kpi.ts` exposes `useEngineeringYieldKpi(projectId)` → `{ scenarioCount, latestP50Mwh }` via TanStack Query, ready to plug into the engineering dashboard later.

## 6. Acceptance checks (executed at end)

1. `psql \d project_yield_config` — old unique gone, composite present; run P-045 proposal stub once and confirm `Proposal` scenario row exists.
2. Create `Base` (tilt 25, fixed) → duplicate to `Tracker` (1p_tracker) → run estimates → deterministic across reloads; label present in UI.
3. Comparison chart renders 2 scenarios with delta column.
4. Zod: tilt 95 or GCR 1.2 blocked with inline error; `audit_logs` row with `action='engineering.yield_scenario_saved'` and changed fields.
5. Upload CSV → file lands in `documents` bucket via existing site-data function; scenario row has `results.imported=true`.
6. Cross-tenant probe via `context.supabase` under RLS returns 0 rows.

## Technical notes

- No new bucket — reuse `documents`.
- No new dependency — `recharts` and `react-hook-form` are already installed.
- Deviations to flag:
  - PVsyst PDF: file stored, metrics captured via form (no PDF parser bundled in the Worker). CSV is auto-parsed. This is called out in the tab copy.
  - Legacy scalar columns on `project_yield_config` kept for now to avoid breaking any other reader; the new `results` jsonb is the source of truth going forward.
