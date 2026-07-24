## P-057 — BOM v1 builder

### 1. Migration `0020_bom.sql`
- `public.bom_snapshots`: standard tenant columns + `version int`, `status text default 'draft' check in ('draft','released','superseded')`, `params jsonb`, `totals jsonb`, `created_by uuid`, `created_at`, `updated_at`. Unique `(project_id, version)`.
- `public.bom_lines`: `snapshot_id references bom_snapshots(id) on delete cascade`, `category text check in ('modules','inverters','bos','cables','structures','transformers','other')`, `item text`, `spec text`, `unit text`, `qty numeric`, `buffer_pct numeric default 0`, `qty_buffered numeric`, `unit_cost numeric`, `notes text`, `company_id uuid`, timestamps.
- Order: `CREATE TABLE` → `GRANT SELECT,INSERT,UPDATE,DELETE … TO authenticated; GRANT ALL … TO service_role` → `ENABLE RLS` → policies.
- Policies: `select` when `is_company_member(company_id)`; `insert/update/delete` when `has_role(auth.uid(),'engineering_admin') or has_role(auth.uid(),'engineer') or has_role(auth.uid(),'company_admin') or has_role(auth.uid(),'super_admin')` (delete restricted to engineering_admin/company_admin/super_admin).
- Indexes: `bom_lines(snapshot_id)`, `bom_snapshots(project_id, version desc)`.
- `updated_at` trigger via `public.set_updated_at()`.

### 2. Pure calculator + tests
- `src/lib/calculators/bom.ts` — pure, browser-safe:
  - `DEFAULT_BUFFERS = { modules: 0.5, inverters: 0, cables: 10, structures: 2, bos: 5 }`.
  - `applyBuffer(qty, pct)` — rounds to 4 decimals, ceils integer units (modules, inverters, structures, transformers).
  - `computeBom(params)`: takes `{ capacity_mwp_dc, module_wp, dc_ac_ratio, inverter_count?, tracker_type, avg_dc_run_m?, modules_per_string?, mv_cable_m_per_mw? }` → returns typed line list with `{category,item,spec,unit,qty,buffer_pct,qty_buffered,unit_cost?}`. Heuristics: modules = `ceil(capacity_kwp / module_wp)`; inverters = provided or `ceil(capacity_mw_ac × ratio_helper)`; strings ≈ `ceil(modules / modules_per_string(default 28))`; DC cable metres ≈ `strings × avg_dc_run_m(default 90) × 2`; MV cable ≈ `capacity_mwp × mv_cable_m_per_mw(default 800)`; structures = `ceil(modules / (modules_per_row=90))`; transformers/BOS defaults; unit costs left null (populated in Batch 07).
- `tests/unit/bom-calculator.test.ts` — Prairie Winds fixture (175 MWp, 550 Wp modules, 42 inverters): asserts module qty, buffered qty rounding, unchanged output snapshot for regression.

### 3. Server functions (`src/lib/bom.functions.ts`)
Thin wrappers only — helpers/schemas imported from `bom.server.ts` (avoid `?tss-serverfn-split` ReferenceError):
- `listBomSnapshots({projectId})`
- `getBomSnapshot({snapshotId})` — snapshot + grouped lines
- `generateBom({projectId})` — reads `projects` + `project_pv_config`, calls `computeBom`, inserts snapshot v=max+1 with lines + totals, `write_audit_log('engineering.bom_generated', …)`
- `updateBomLine({lineId, qty?, buffer_pct?, unit_cost?, notes?})` — recomputes `qty_buffered` server-side; blocks edits when snapshot `status='released'` (returns 409)
- `releaseBom({snapshotId})` — engineering_admin only (assertRole); flips status to `released` and prior versions to `superseded`; audit `engineering.bom_released`
- `getMyBomRoles({projectId})` → `{ canWrite, canRelease }`
- `getBomKpi({projectId})` → `{ releasedTotalCost, snapshotCount }`
- `src/lib/bom.server.ts` — role/audit helpers, zod schemas, category labels, project-loading query.

### 4. Query hooks (`src/lib/bom-query.ts`)
`queryOptions` for snapshots/details/roles; mutations for generate/updateLine (optimistic recalc)/release with invalidation + sonner.

### 5. UI
- Route: `src/routes/_authenticated/projects.$projectId.engineering.bom.tsx`, plus `bom` entry in engineering sub-nav.
- `bom-header.tsx` — version select, status badge, params summary, totals; "Regenerate" (writer) and "Release" (engineering_admin) buttons.
- `bom-table.tsx` — grouped by category with `useReducer` for local edits (qty/buffer/unit_cost), live `qty_buffered` = `applyBuffer(qty, pct)` recompute, blur commits via `updateBomLine`. Read-only when released.
- `bom-empty.tsx` — "No BOM yet — generate from archetype config" with Generate CTA.
- CSV export button → constructs CSV client-side from loaded lines.
- States: `Suspense` skeleton, error boundary card, empty state. Semantic tokens only.

### 6. Verification
- Apply migration; `bunx tsgo --noEmit`; `bun run test` (new calculator suite).
- Manual: on Prairie Winds, generate → v1 populated; edit cable buffer live; release as engineering_admin (verify audit row); attempt release as engineer (403).

### Technical notes
- BOM totals stored on snapshot as `{ line_count, total_cost, generated_from: {config_versions...} }` for the Batch 07 procurement KPI.
- All writes go through `requireSupabaseAuth`; server always recomputes `qty_buffered` to prevent client tampering.
- CSV export is client-side only (no server function needed).