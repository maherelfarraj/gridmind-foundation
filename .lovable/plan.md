
# P-045 — Proposal Builder + Yield Stub

## Files to create

### Yield engine (pure, deterministic)
- `src/lib/yield/stub.ts` — engine id `gridmind-stub-v1`
  - `mulberry32(seed)` PRNG + `hashString(s)` FNV-1a → seed from normalized JSON of config
  - Sunrise/sunset from latitude + day-of-year (NOAA-style declination approx)
  - Per-hour: clear-sky bell curve × seeded monthly weather derate (0.82–1.00) × (1 − combined losses) × (1 − degradation_y1/2), DC clipped to `dc_capacity_kw`, then AC clipped to `ac_capacity_kw`
  - Returns `{ engine, computed_at, p50_kwh, p90_kwh, specific_yield_kwh_kwp, performance_ratio, monthly:number[12] }` with `p90 = p50 × (1 − 1.2816 × sigma)`
  - No `Date.now()`/`Math.random()` inside computation — `computed_at` supplied by caller for determinism of results

### Server functions
- `src/lib/proposal.functions.ts` — add:
  - `getProposal({ proposalId })` — returns proposal + line items + opportunity name (RLS)
  - `listProposals({ opportunityId? })` — for `/proposals` list
  - `createProposal({ opportunityId })` — insert draft v1 with default currency, audit `proposal.created`
  - `saveProposalHeader({ proposalId, title, currency_code, contingency_pct, margin_pct, valid_until, notes })` — recomputes totals server-side; audit `proposal.updated`
  - `saveLineItems({ proposalId, items[] })` — full replace inside a diff (insert/update/delete by id); recomputes subtotal/total; guarded by `proposals_guard_immutable` (draft/in_review only); audit `proposal.lines_saved`
  - `saveArrayConfig({ proposalId, array_config })` — zod schema for all fields; audit `proposal.array_config_saved`
  - `runYieldStub({ proposalId })` — loads array_config, calls `stub.ts`, persists into `proposals.yield_result`; if `proposals.project_id` set, upsert `project_yield_config` (map `p50_kwh→p50_mwh/1000`, `p90_kwh→p90_mwh/1000`, degradation, availability, losses); wrap in try/catch — on `42P01` or missing-column PG errors (`42703`) log + continue. Audit `proposal.yield_simulated` with `{opportunity_id, p50_kwh, p90_kwh}`
- Write gating: `sales` or `company_admin` (mirrors existing pattern); `finance_admin` read-only

### Query layer
- `src/lib/proposal-query.ts` — `queryOptions` for `getProposal`, `listProposals`; invalidation helpers

### Routes
- `src/routes/_authenticated/proposals.index.tsx` — table list (title, opportunity, version, status badge, total, updated_at) with skeleton/empty/error
- `src/routes/_authenticated/proposals.$proposalId.tsx` — builder page
  - Loader: `ensureQueryData(getProposal)`; branded not-found if missing
  - Tabs / stacked cards: **Scope & pricing**, **Array config**, **Yield simulation**
  - Header strip: title, version, status badge, opportunity link, "Create new version" button (existing `createProposalVersion`)

### Components (under `src/components/proposals/`)
- `ProposalHeaderCard.tsx` — inline edit for title/currency/contingency/margin/valid_until/notes, RHF + zod
- `LineItemsGrid.tsx` — editable rows (category, description, qty, unit, unit_price, computed line_total), add/remove, live subtotal/contingency/margin/total tiles using `Intl.NumberFormat` with `currency_code`. Debounced autosave via `saveLineItems`
- `ArrayConfigForm.tsx` — RHF + zod for the full `array_config` schema (dc/ac kW, tilt, azimuth, gcr, tracking select, latitude, module_w, inverter text, losses{...}, degradation_y1_pct, p90_sigma default 0.04)
- `YieldSimulationCard.tsx` — "Run simulation" button (calls `runYieldStub`), P50/P90 tiles, `specific_yield_kwh_kwp`, `performance_ratio`, Recharts monthly bar chart, engine + computed_at footer, visible disclaimer text: *"Placeholder engine — replaced by PVsyst import in Stage 2 (Engineering)"*

### Opportunity integration
- Update `OpportunityHeaderCard` "New proposal" quick action → call `createProposal({opportunityId})` then navigate to `/proposals/$proposalId`
- Update activity timeline (already merges proposals) — no change needed; new audit events will appear

## Determinism guarantees
- PRNG seeded from `hashString(JSON.stringify(normalizedConfig))` where normalization sorts keys and rounds floats to 6 decimals
- Weather derate table generated once from seeded PRNG at engine start
- No `Date.now()` or `Math.random()` in the compute path
- Test hook: exporting `simulateYield(config)` pure function so identical config → identical `{p50_kwh, p90_kwh, monthly}`

## Graceful degradation
- `project_yield_config` table exists but uses `p50_mwh/p90_mwh` schema — upsert path converts units and catches `42P01`/`42703`/`PGRST204` errors, logs via `console.warn`, continues successfully

## Roles
- Read: any company member
- Edit line items / array config / run simulation: `sales` or `company_admin`
- `finance_admin`: read-only (form fields disabled, buttons hidden)

## Verification checklist
1. Create proposal from opportunity → add 3–4 lines → totals recompute live
2. Set 150,000 kW DC / 125,000 kW AC, tilt 25, single_axis, latitude 31.9 → run sim → tiles + monthly chart render, specific yield 600–2200 kWh/kWp, P90 < P50
3. Run twice with unchanged config → byte-identical P50/P90/monthly
4. Disclaimer visible; `proposal.yield_simulated` audit row present
5. `finance_admin` sees read-only UI
