## P-082 — Project finance: PPA, LCOE, Lender DD, Bank facilities

Batch 08 finale. Four new tables + one route with four tabs. `documents` bucket already exists (private) and its `storage.objects` policies scope writes by the first path segment (`company_id`), so the spec's `{company_id}/lender-dd/{project_id}/…` path works as-is.

### 1. Migration `0038_project_finance.sql`
Ship as spec, with the small guardrails our other migrations use:
- Wrap both enum creates in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` (spec allows a guarded do-block; makes the migration re-runnable).
- Tables verbatim from the spec (columns, defaults, CHECK on `bank_facilities.drawn_amount ≤ commitment_amount`).
- `updated_at` maintained by the shared `set_updated_at` trigger on all four tables (matches the pattern from earlier batches — no bespoke function).
- Grants as spec: `authenticated` gets `SELECT, INSERT, UPDATE`; no DELETE grant (7-year retention). Add `GRANT ALL … TO service_role` for admin/edge paths.
- RLS policies exactly per spec (SELECT scoped by `is_company_member`; writes gated by finance/company admin, DD adds `legal_admin`).
- Indexes as spec.

### 2. Rules module `src/lib/project-finance.rules.ts`
Pure, testable helpers, one Zod schema per entity + shared types:
- `computeLcoe({ capex, opex_annual, discount_rate_pct, annual_energy_mwh, degradation_pct, project_life_years })` — the discounted-numerator / discounted-denominator formula from the spec; guards `annualEnergy > 0`, `r ≥ 0`, `life ≥ 1`.
- `ppaYearOneRevenue(tariff, annualEnergyMwh)`.
- `facilityUtilizationPct(drawn, commitment)` + `over-commitment` guard.
- `ddReadinessPct(items)` = `(accepted + waived) / total`; helper `ddReadinessBucket(pct)` → `ok ≥ 80 | warn`.
- `isOverdue(dueDate)` for DD rows.
- Zod: `PpaUpsertSchema`, `LcoeUpsertSchema` (no `lcoe` field — server computes), `DdUpsertSchema`, `DdStatusChangeSchema`, `FacilityUpsertSchema`, `FacilityDrawdownSchema`.

Unit tests `tests/unit/project-finance-rules.test.ts`:
- LCOE hand-calc: capex $120M, opex $1.8M, r=7%, 260 GWh, 25y, 0.5% deg ≈ `$0.0637 /kWh` (verify our implementation to 4 decimals).
- PPA year-one revenue $55 × 260,000 MWh = $14.3M.
- Utilization boundary: draw = commitment → 100%; over-draw returns error before hitting DB.
- DD readiness 5/6 accepted+waived → 83.3% → `ok`.

### 3. Server functions
Split by entity to keep files tight — every mutation is `createServerFn + zod + requireSupabaseAuth + writeAuditLog`:

- `src/lib/ppa.functions.ts` — `listPpaTerms(projectId)`, `upsertPpaTerms`, `getPpaAccess`. Audit `ppa.create` / `ppa.update`.
- `src/lib/lcoe.functions.ts` — `listLcoeScenarios(projectId)`, `upsertLcoeScenario` (computes and persists `lcoe`), `deleteLcoeScenario` blocked (no delete grant); audit `lcoe.save`.
- `src/lib/lender-dd.functions.ts` — `listDdItems(projectId)`, `upsertDdItem`, `changeDdStatus({ id, status, note? })` (audit `dd.status_change` with `{ from, to, note }`), `signDdDocumentUploadUrl({ projectId, filename, mime })` returning a `documents` bucket signed upload URL rooted at `{company_id}/lender-dd/{project_id}/…` (mirrors `opportunity.functions.ts` upload helper).
- `src/lib/bank-facilities.functions.ts` — `listBankFacilities(projectId?)`, `upsertBankFacility`, `recordFacilityDrawdown({ id, amount })` (validates `drawn + amount ≤ commitment`, updates `drawn_amount`, audit `facility.drawdown` with `{ amount, previous_drawn, new_drawn }`), `getBankFacilitiesAccess`.

Roles enforced via existing `has_company_role` RPC:
- Finance/company admin write everywhere.
- Legal admin additionally writes DD (matches RLS).
- Read is anyone in the company (RLS SELECT).

### 4. Query modules
- `src/lib/ppa.query.ts`
- `src/lib/lcoe.query.ts`
- `src/lib/lender-dd.query.ts`
- `src/lib/bank-facilities.query.ts`
Each exports `list/detail/access queryOptions` (staleTime 15–30s) and a shared `projectFinanceErrorMessage(err)` (put in a new `src/lib/project-finance-query.ts` re-exported by all four to avoid duplication).

### 5. Routes
Layout: `src/routes/_authenticated/projects.$projectId.finance.project-finance.tsx` — sub-tab bar (PPA | LCOE | Lender DD | Facilities) via `<Outlet />`, mirroring `projects.$projectId.finance.tsx`.

Add tab entry `{ to: 'project-finance', label: 'Project finance' }` to the existing Finance layout `src/routes/_authenticated/projects.$projectId.finance.tsx` so it shows up under the Finance module.

Leaf routes (each with `head()`, `loader → ensureQueryData`, `errorComponent` with retry, `notFoundComponent`, skeleton and empty states, CSV export button):

- `projects.$projectId.finance.project-finance.ppa.tsx` — table (name, counterparty, term, tariff, currency, capacity, annual MWh, year-1 revenue), header KPI: portfolio year-1 revenue Σ; `Add PPA` opens a **drawer form** with fields per spec including a lightweight `LiquidatedDamagesEditor` (jsonb key/value grid) and a linked-contract select filtered to signed/active contracts on the project. Derived "Year-1 revenue" tile inside the drawer updates live.

- `projects.$projectId.finance.project-finance.lcoe.tsx` — split view. Left: scenarios table (name, capex, opex, r, energy, life, LCOE, updated). Right: drawer form for create/edit with a live **hand-calc preview** (uses the pure `computeLcoe`) so users see the number before saving; server recomputes and persists on submit. **Compare panel** below: Recharts `BarChart` of LCOE per scenario using token colors (`hsl(var(--primary))`, `hsl(var(--accent))`, etc.) and a sensitivity note: "Lowest LCOE scenario: {name} at r = {rate}%".

- `projects.$projectId.finance.project-finance.dd.tsx` — checklist grouped by category (technical, legal, financial, hse, insurance, esg — collapsible groups with counts). Row shows title, status pill, owner avatar, due date (destructive text if `dueDate < today` and status ∉ accepted|waived), document link/upload button, response note popover. Status change is a small `<Select>` — inline mutation, audited. Header KPI tile **DD readiness** (`ddReadinessPct`) with `warn` / `ok` tokenized colors and a small "n of m complete" caption. `Add item` drawer. Document upload posts to signed URL from `signDdDocumentUploadUrl`, then stores the returned `document_path` on the row (mirrors existing `opportunity` upload flow); rejects non-PDF/DOCX and >20 MB client-side.

- `projects.$projectId.finance.project-finance.facilities.tsx` — table columns: lender, type, commitment, drawn, **utilization %** as a horizontal bar (`div` with width % using token colors — no raw hex), rate, maturity, status. KPI header: portfolio utilization (Σ drawn / Σ commitment). Row action `Record drawdown` opens a small dialog; `Add facility` drawer form (lender, type, currency, commitment, rate, margin, maturity, covenants grid — jsonb array of `{name, threshold, measured_at, status}`). DB CHECK provides the belt; server also validates for a friendly toast.

Navigation: add to `src/lib/nav-map.ts` under the project Finance section (a "Project finance" entry). Sub-tabs are surfaced via the layout above.

### 6. UI conventions
- All colors from semantic tokens (`bg-muted`, `text-destructive`, `bg-primary/10`, `border-emerald-500/40` reserved for status greens as done in Change orders).
- Money via `Intl.NumberFormat` with each row's `currency_code`.
- Dates via `date-fns` (`format`, `isBefore`).
- Skeleton = 4-row shimmering table rows; empty = card with headline + `Add` CTA; error = card + `Try again` calling `router.invalidate()` + Query `reset()`.
- CSV export button on every list tab, filename `{tab}-YYYYMMDD.csv`.

### 7. Verification checklist
1. Apply the migration twice — second run is a no-op (guarded enum + `IF NOT EXISTS`).
2. Confirm all four tables have RLS enabled (`SELECT relrowsecurity FROM pg_class`) and that a member of company A cannot read company B's rows.
3. Add a PPA: term 25y, tariff $55, annual energy 260,000 MWh → drawer year-1 revenue reads $14,300,000.
4. Create LCOE scenario: capex 120,000,000, opex 1,800,000, r 7%, 260,000 MWh, life 25 → persisted `lcoe` matches unit-test hand-calc (~$0.0637/kWh). Add a second scenario; verify bar chart renders both bars and sensitivity note.
5. DD: create six items across categories, walk one from `not_started → in_progress → submitted → accepted`, waive one, leave one overdue in `submitted` → readiness KPI updates and overdue row shows destructive text; upload a PDF and confirm the stored `document_path` begins with `{company_id}/lender-dd/{project_id}/`.
6. Facility: create $80M construction loan, record $30M drawdown → utilization bar reads 37.5%; attempt $60M drawdown → server returns 422 (over-commitment), DB CHECK prevents any partial write.
7. Grep `audit_logs` for `ppa.*`, `lcoe.save`, `dd.status_change`, `facility.drawdown` after each action.
8. Skeleton renders during `useQuery.isPending`; empty state visible on a fresh project; CSV downloads a UTF-8 file with the right header row on all four tabs.

Batch 09 (Field/HSE/QAQC) kickoff once green.
