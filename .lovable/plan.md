## P-081 — Change order workflow, budget & schedule propagation, approval hook

Table `change_orders` (migration 0036) and minimal CRUD (P-079) already exist. This batch adds the workflow, propagation, and UI. No schema migration is required — all needed columns (`status`, `submitted_by/at`, `approved_by/at`, `approval_instance_id`, `budget_impact`, `schedule_impact_days`, `wbs_item_id`) are in place, and `budgets.current_amount` is already a generated column (`original_amount + approved_changes`). `approval_rules` does not exist yet, so the inline fallback path ships now.

### 1. Rules (`src/lib/change-orders.rules.ts`)
- Add `BudgetImpactBalanced` helper: `sumBudgetImpact(lines) === amount` within ±$0.01; used both client-side (form disable) and server-side (reject).
- Add allowed-transition map:
  - draft → submitted, draft edits allowed
  - submitted → under_review | approved | rejected
  - under_review → approved | rejected
  - approved → incorporated
  - rejected: terminal, edits blocked
  - incorporated: locked (no edits, no status change)
- Add `exposurePct(approvedCoAmount, contractValue)` + bucket `{ ok | warn (>5%) | danger (>10%) }`.
- Add `shiftUnstartedTasks(tasks, days)` pure helper: returns `{ shifted: Task[], skipped: Task[] }`, only tasks with `status === 'not_started'` are shifted; used by server + surfaced in warning banner.

### 2. Server functions (`src/lib/change-orders.functions.ts`)
Extend the existing file. Roles enforced via `has_company_role`:
- create/edit/submit: `project_admin` | `finance_admin` | `company_admin`
- approve/reject/incorporate: `finance_admin` | `company_admin`

New RPCs (each in one server transaction using an RPC where multi-row updates are needed — see §3):
- `submitChangeOrder({ id })` — draft → submitted; sets `submitted_by/at`; if `approval_instances` table has usable rows (checked with a try/catch insert), create instance with `entity='change_orders'`, `entity_id=co.id`, `metadata={ amount, threshold_bucket }`, store id in `approval_instance_id`; otherwise leave null (inline fallback). Audit `co.submit`.
- `approveChangeOrder({ id, note? })` — calls new SQL RPC `approve_change_order(co_id, note)` that:
  1. Verifies status ∈ {submitted, under_review}; locks row.
  2. For each `budget_impact` line, upserts `budgets.approved_changes += amount` for matching `(project_id, cost_code_id, latest version)`; errors if no matching budget row.
  3. Sets `status='approved'`, `approved_by/at`.
  4. Returns `{ budgets_touched: uuid[] }`.
  Then writes audit `co.approve` with `{ co_id, budgets_touched, note }`. Schedule shift is NOT applied here (spec: only on incorporate).
- `rejectChangeOrder({ id, note })` — note required (zod min 1); status → rejected; audit `co.reject` with note.
- `incorporateChangeOrder({ id })` — RPC `incorporate_change_order(co_id)`:
  1. Verifies status = 'approved'; locks row.
  2. If `schedule_impact_days > 0` and `wbs_item_id` set, updates all `schedule_tasks` where `wbs_item_id = co.wbs_item_id AND status = 'not_started'`, setting `start_date = start_date + days`, `end_date = end_date + days`. Returns list of shifted task ids.
  3. Sets `status='incorporated'`.
  4. Returns `{ tasks_shifted: uuid[] }`.
  Audit `co.incorporate` with `{ co_id, tasks_shifted, days }`.
- Harden existing `upsertChangeOrder`: block edits when `status ∈ {approved, rejected, incorporated}`; when submitting a new row (`status='submitted'`), validate `Σ budget_impact = amount` (reject otherwise, HTTP 422).

### 3. Migration `0038_change_order_workflow.sql`
Two SECURITY DEFINER functions (search_path=public) — pure SQL because they mutate multiple rows atomically:
- `public.approve_change_order(p_co_id uuid, p_note text)` returns `jsonb` — asserts caller role via `has_company_role`, does the budget upsert loop over `co.budget_impact`, updates CO. Errors if any `budget_impact` cost_code has no matching latest-version budget row.
- `public.incorporate_change_order(p_co_id uuid)` returns `jsonb` — asserts role, shifts unstarted tasks, updates CO.
- Grants EXECUTE to `authenticated`, and both functions re-check role inside.
No new tables, no RLS changes.

### 4. Query helpers (`src/lib/change-orders.query.ts`)
Extend with:
- `changeOrderDetailQueryOptions(coId)` — CO + linked contract (title, signed_amount, currency) + wbs item + affected budgets rows + audit trail (last 20 events for entity).
- `contractsForProjectQueryOptions(projectId)` — signed/active contracts for the select.
- `budgetsForProjectQueryOptions(projectId)` — latest-version budget rows keyed by cost_code_id (drives the budget_impact grid and validation).
- `projectApprovedCoExposureQueryOptions(projectId)` — sum of amounts where status ∈ {approved, incorporated}, grouped by contract, for the KPI tile.

### 5. UI

**List page** `projects/$projectId/finance/change-orders.tsx` (rewrite of the P-079 stub):
- Header: "Change orders" + `New CO` button.
- KPI strip: **Approved CO exposure** tile — `Σ approved+incorporated / Σ contract values`, tokenized colors (`ok`, `warn amber >5%`, `danger destructive >10%`), per-contract breakdown popover.
- Toolbar: search (co_number/title), status filter (multi), CSV export (`co-YYYYMMDD.csv`).
- Table columns: `co_number`, `title`, contract name, signed amount (Intl currency), schedule impact days, status badge (tokenized per status), updated_at (`date-fns` `formatDistanceToNow`). Row → detail link.
- Skeleton, empty ("No change orders yet"), and error states via existing `payAppErrorMessage`-style helper (add `changeOrderErrorMessage`).

**Detail page** `projects/$projectId/finance/change-orders.$coId.tsx` (new):
- Header with `co_number`, title, status pill, and impact chip row:
  - Amount chip — Intl currency, signed; destructive when `abs(amount) > 5% * contract.signed_amount`.
  - Schedule impact chip — `+N days` / `0`.
- Sections:
  1. **Overview** — description, contract link, WBS item, submitted/approved metadata.
  2. **Budget impact table** — cost code, code name, current budget, impact amount, new current amount preview; total row with Σ = amount checkmark.
  3. **Schedule preview** — if `wbs_item_id` set and days > 0, list unstarted tasks that would shift, with new dates (uses `shiftUnstartedTasks`). Started tasks shown as "untouched (started)".
  4. **Approval trail** — submitted_by / at, approved_by / at, note, and the last audit events for this CO.
- Action bar (role- and status-gated):
  - draft: **Edit**, **Submit**
  - submitted / under_review: **Approve**, **Reject** (dialog, mandatory note)
  - approved: **Incorporate** (confirmation dialog listing tasks that will shift)
  - rejected / incorporated: no actions; banner explaining lock.

**Create/Edit dialog** (react-hook-form + zod):
- Fields: title, description, contract select (signed/active only), currency (locked to contract currency if set), amount (money input, sign toggle for cost add vs credit), schedule_impact_days (int spinner, default 0), wbs_item_id select (filtered to project).
- Budget impact grid: rows for every latest-version budget in the project; user enters amount per row; live Σ vs amount indicator; submit disabled when unbalanced. Server re-validates.
- On save: draft. Separate **Submit** button on the detail page triggers `submitChangeOrder`.

**Navigation**: add "Change orders" to `src/lib/nav-map.ts` under the project Finance section (if not already), and add sub-nav link inside the Finance layout.

### 6. Audit events (five, matching spec)
`co.create`, `co.submit`, `co.approve`, `co.reject`, `co.incorporate` — all with `{ co_id, ...ctx }` metadata; `co.approve` includes `budgets_touched`, `co.incorporate` includes `tasks_shifted` + `days`.

### 7. Tests (`tests/unit/change-orders-rules.test.ts`)
- `nextChangeOrderNumber` year-scoped rollover (existing).
- `sumBudgetImpact` balance check within tolerance.
- Transition matrix (allowed / forbidden pairs).
- `exposurePct` bucket boundaries (5%, 10%).
- `shiftUnstartedTasks` — skips started/in_progress/complete, shifts `not_started` by N days preserving duration.

### 8. Verification (matches the propagation checklist)
1. Create CO-2026-0001 "+$450k" with `budget_impact` mapped to `02-2000 Equipment` — verify server rejects when `Σ ≠ amount`.
2. Submit → approve as `finance_admin` — read `budgets` row, confirm `approved_changes += 450000` and `current_amount` moved (generated column).
3. Set `schedule_impact_days=21` on the CO, incorporate — verify `not_started` tasks under the linked WBS shifted +21 days, started tasks untouched, CO now locked (Edit disabled, no further status changes).
4. Reject flow — dialog requires note; audit row includes note.
5. Confirm all five audit rows exist for the CO.
6. Exposure tile colors: seed one project with 6% and one with 12% approved exposure and eyeball the KPI badge.

### Technical notes
- `approve_change_order` / `incorporate_change_order` are SQL SECURITY DEFINER functions because we need atomic multi-row writes; RLS is re-enforced via explicit `has_company_role` checks and by joining through `change_orders.company_id`.
- `approval_instances` insert is best-effort (wrapped in try/catch); when it fails or the table is missing (it exists but unused today), CO simply keeps `approval_instance_id = null` and inline Approve/Reject remains authoritative. Field name is stable so Batch 12 can back-fill without a schema change.
- All money math uses `numeric(14,2)` server-side; client uses `Intl.NumberFormat`. Dates via `date-fns`. Design tokens only; no raw hex.
