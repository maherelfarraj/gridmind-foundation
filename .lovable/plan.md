
## P-074 — Risk Register

Schema is in place from P-071 (`risks` table, generated `score = probability × impact`, `risk_status` enum, append-only via missing DELETE grant). `category` is `text` — validated via zod against the fixed list. No migration.

### Server (`createServerFn` + zod + `requireSupabaseAuth`)

- `src/lib/risks.rules.ts` — pure helpers + zod schemas:
  - `RISK_CATEGORIES = ['schedule','cost','technical','hse','commercial','regulatory']`, `RISK_STATUSES = ['open','mitigating','realized','closed']`.
  - `riskCreateSchema`, `riskUpdateSchema` (partial), `riskDeleteSchema` — title 1..200, description, category enum, probability/impact 1..5 int, status enum, owner_id uuid|null, mitigation text, contingency_amount ≥ 0, currency_code 3-letter, target_close_date, identified_at.
  - `scoreOf(p,i)`, `bandForScore(s)` (`low <5`, `medium <10`, `high <15`, `critical ≥15`).
  - `registerAgeDays(rows, today)` → days since max(identified_at); `bandForAge(days)` → `ok ≤14`, `warning 15–30`, `destructive >30`.
  - `matrixCells(rows)` → 5×5 buckets keyed by `${p}-${i}` with chip lists.
  - `heatCellClass(p,i)` — returns semantic token class scaled by score (e.g. `bg-primary/5`, `bg-primary/10`, `bg-warning/15`, `bg-destructive/15`, `bg-destructive/25`) — never raw hex.
  - `sumContingency(rows)` over `open`+`mitigating` only.
  - `formatCurrency(amount, code)` — `Intl.NumberFormat` with fallback.

- `src/lib/risks.functions.ts`:
  - `getRisksAccess` → `{ canWrite }` from `has_company_role('project_admin'|'hse_admin'|'finance_admin'|'company_admin')`.
  - `listRisks({projectId})` — joins `profiles` for owner full_name/email.
  - `listProjectMembers({projectId})` — profiles in same company for the owner select.
  - `createRisk`, `updateRisk`, `deleteRisk` (write roles above).
    - `createRisk` defaults `identified_at = today`, `status = 'open'`.
    - `updateRisk`: when status transitions to `closed` sets `closed_at = now()`; when moving out of `closed` clears it. Emits `risk.status_change` audit in addition to `risk.update` on status change.
  - Every mutation calls `write_audit_log` (`risk.create` / `risk.update` / `risk.status_change` / `risk.delete`).

- `src/lib/risks.query.ts` — `queryOptions` for access, risks list, project members; `riskErrorMessage(err)`.

### UI

- `src/routes/_authenticated/projects.$projectId.planning.tsx` — add `{ to: 'risks', label: 'Risks' }` to `SUB_TABS`.
- `src/routes/_authenticated/projects.$projectId.planning.risks.tsx` — leaf route with `head()` metadata, `pendingComponent` skeleton, `errorComponent` (retry via `router.invalidate()`), orchestrator component holding tab state (`matrix` | `register`) and selected risk drawer state.
- `src/components/planning/risk-kpi-strip.tsx` — 4 cards: open risks count, high-risk count (score ≥ 15, destructive text), contingency exposure (Intl-formatted; groups by currency if mixed — shows primary + "+N more" tooltip), register age (green/amber/destructive with tooltip "Risk register freshness — review monthly").
- `src/components/planning/risk-matrix.tsx` — 5×5 grid, x = impact 1→5, y = probability 5→1 (top-left = high P / low I). Each cell = `heatCellClass(p,i)` background, header rows/cols labelled (Very Low → Very High). Chips render truncated title with tooltip; click opens drawer. Empty cells show subtle dot.
- `src/components/planning/risk-register-table.tsx` — server data + client filter/search:
  - Columns: title, category badge, P, I, Score (bold; destructive when ≥15), Owner (profiles.full_name || email fallback), Status badge, Target close, Age (days since identified_at).
  - Toolbar: search (title/description), category filter, status filter, "New risk" (role-gated), "Export CSV".
  - Empty state: "No risks logged — a stale register fails lender due diligence." Skeleton loading, error retry.
- `src/components/planning/risk-drawer.tsx` — shadcn `Sheet` + react-hook-form + zod:
  - Fields: title, description textarea, category `Select`, probability `Slider` 1–5 + label (Very Low..Very High), impact same, live score preview with band chip, owner `Select` (project members), mitigation textarea, contingency amount input + currency `Select` (3-letter, default from project or `USD`), target close date (shadcn date picker with `pointer-events-auto`), status `Select` with allowed transitions from current (`open → mitigating`, `mitigating → realized|closed`, closed → open reopen).
  - Submit disabled when `!canWrite`.
- `src/lib/risks.csv.ts` — CSV export: title, category, probability, impact, score, status, owner, identified_at, target_close_date, contingency_amount, currency_code.

Cell heat scale (semantic tokens only):

```text
score 1–4   → bg-muted/40
score 5–8   → bg-primary/10
score 9–12  → bg-warning/15
score 13–14 → bg-warning/25
score 15–19 → bg-destructive/15
score 20–25 → bg-destructive/25
```

### Verification (in build mode)

1. `tests/unit/risks-rules.test.ts` — `scoreOf`, `bandForScore`, `registerAgeDays` + `bandForAge` boundaries (14/15/30/31), `matrixCells` placement, `sumContingency` (excludes realized/closed), `heatCellClass` returns token class strings only, category/probability zod validation.
2. `bunx tsgo --noEmit` clean.
3. Preview smoke: log the three acceptance risks, edit grid-delay impact 4→3 (chip moves live), verify KPI bands, transition open→mitigating→closed and confirm `closed_at` + audit rows in `audit_logs`, CSV export.

### Non-goals

- No bulk import / template library (defer to later).
- No mitigation task linkage to `schedule_tasks` (out of scope for P-074).
- No historical trend chart of risk scores over time.

### Follow-up after green

P-075 — budgets + cost codes migration.
