## P-046 — Pricing checklist + CFO approval gate

Add a "Pricing & approval" section to the proposal builder that computes a server-side checklist, gates submission to a `finance_admin` CFO approval workflow (using existing `approval_instances` + `approvals` tables), and enforces the lock in SQL after approval.

### 1. Migration — `proposals_enforce_pricing_lock`

New migration `20260724_pricing_lock.sql` (idempotent):
- `create or replace function public.proposals_enforce_pricing_lock()` — raises when `old.pricing_lock->>'status'='approved'` and any of `margin_pct / fx_rate_snapshot / contingency_pct / subtotal / total` change. Updates to `pricing_lock` itself remain allowed.
- `drop trigger if exists trg_proposals_pricing_lock` + `create trigger trg_proposals_pricing_lock before update on public.proposals`.

No new tables — `approval_instances` and `approvals` already exist from 0014 with the expected columns.

### 2. Constants (`src/lib/pricing-rules.ts`)

```ts
export const COMPANY_BASE_CURRENCY = "USD";
export const MARGIN_FLOOR_PCT = 8;
export const CONTINGENCY_FLOOR_PCT = 5;
export const FX_MAX_AGE_HOURS = 24;
export const PRICING_ENTITY = "proposal_pricing";
export const PRICING_RULE_KEY = "proposal_pricing_cfo";
```

(There is no `companies.base_currency` column today; `USD` is the placeholder base per the spec's "configurable constant" wording — swappable when P-111 adds per-company config.)

### 3. Server functions — extend `src/lib/proposal.functions.ts`

All use `createServerFn` + zod + `attachSupabaseAuth` + `requireSupabaseAuth`.

- `getPricingChecklist({ proposalId })` — returns `{ items: ChecklistItem[], allPass: boolean, pricingLock, approvalInstance }` where each item is `{ key, label, pass, detail? }`. Checks:
  - `line_items_priced` — every `qty > 0` and `unit_price >= 0`; `abs(Σ line_total − subtotal) < 0.01`.
  - `margin_floor` — `margin_pct >= 8`.
  - `fx_snapshot` — currency = `COMPANY_BASE_CURRENCY` → pass; else `fx_rate_snapshot` non-null AND latest `fx_rates` row where `base_code=USD and quote_code=currency` has `as_of` within 24h. If no fx_rates row exists → fail with detail "no FX rate available".
  - `contingency_floor` — `contingency_pct >= 5`.
  - `valid_until_future` — set and `> now()`.
  - `competitor_recorded` — join `opportunities.competitor` non-empty.
  - `yield_run` — `yield_result` has non-null `p50_kwh` and `p90_kwh`.
  - Also loads latest `approval_instances` for `entity='proposal_pricing', entity_id=proposalId` and returns it (for the UI pending badge).

- `submitPricingApproval({ proposalId })` — writer role check (sales OR company_admin); revalidate the checklist server-side and refuse if any fail. Dual path:
  1. Try `insert into approval_instances (company_id, entity='proposal_pricing', entity_id, status='pending', requested_by, metadata={rule_key:'proposal_pricing_cfo', margin_pct, contingency_pct, fx_rate_snapshot, currency_code})`; then insert one `approvals` row per `finance_admin` in the company (from `user_roles`) with `status='pending'`.
  2. On PG error code `42P01` / undefined column: fall back to `update proposals set pricing_lock = {status:'pending', requested_by, requested_at, margin_pct, fx_rate_snapshot, contingency_pct}`.
  Always also stamp `proposals.pricing_lock` with the pending payload so the UI has a single source of truth; audit `proposal.pricing_submitted` with `{opportunity_id, instance_id?}`.

- `decidePricingApproval({ proposalId, decision: 'approve'|'reject', comment? })` — `finance_admin` only (checked via `has_company_role`). Dual path:
  1. Update matching `approval_instances` row: `status`, `decided_by=auth.uid()`, `decided_at=now()`. Update the caller's `approvals` row with `status` + `comment`.
  2. Fallback: update `proposals.pricing_lock` directly.
  On approve: also `update proposals set pricing_lock = {status:'approved', approved_by, approved_at, margin_pct, fx_rate_snapshot, contingency_pct}, status='approved'`. On reject: `pricing_lock = {status:'rejected', rejected_by, rejected_at, comment}`; leave `proposals.status` as-is.
  Audit `proposal.pricing_approved` / `proposal.pricing_rejected` with `{opportunity_id, comment?}`.

### 4. Query hooks — `src/lib/proposal-query.ts`

- `pricingChecklistQueryOptions(fn, proposalId)` — `staleTime: 5s`.
- `useSubmitPricingApproval(id)`, `useDecidePricingApproval(id)` — invalidate `["proposal", id]` and `["pricing-checklist", id]`.

### 5. UI — `src/components/proposals/PricingApprovalCard.tsx`

Rendered below `YieldSimulationCard` in `proposals.$proposalId.tsx`.
- Header: "Pricing & approval" with a status badge (`Draft` / `Pending CFO review · Nh ago` / `Approved by X` / `Rejected`).
- Checklist list — each row a `Check` (success) or `X` (destructive) icon + label + optional `detail`. Failing rows in `text-destructive`.
- Actions:
  - Writers (sales / company_admin): "Submit to CFO" button — disabled unless `allPass` and status not already `pending`/`approved`. Uses `date-fns` for "requested Nh ago".
  - `finance_admin` sees Approve / Reject buttons when a pending instance exists; Reject opens a small dialog with a comment textarea.
- After approval, `ProposalHeaderForm` and `LineItemsGrid`/`ArrayConfigForm` respect a new `pricingLocked` flag (already implicit through `readOnly` when status leaves draft, but also add a `Lock` icon next to `margin_pct` / `contingency_pct` / currency inputs when `pricing_lock.status='approved'`). Locked fields render read-only with a tooltip "Locked by CFO approval — create a new version to change".

Route (`proposals.$proposalId.tsx`):
- Extend the loader to also `ensureQueryData` the checklist.
- Compute `pricingLocked = proposal.pricing_lock?.status === 'approved'`. Pass into the three edit cards so they show lock icons even when the writer still has editor role in draft/in_review.

### 6. Audit metadata

Every mutation calls `writeAuditLog(action, 'proposal', proposalId, { opportunity_id, ...context })`. Adds three actions: `proposal.pricing_submitted`, `proposal.pricing_approved`, `proposal.pricing_rejected`.

### 7. Verification (post-implementation)

- Live typecheck.
- Query approval flow via `supabase--read_query`:
  1. Create a proposal, set margin to 5% → checklist row fails → submit button disabled.
  2. Fix values → all pass → submit → assert one row in `approval_instances` with `entity='proposal_pricing'` and one audit row `proposal.pricing_submitted`.
  3. As finance_admin: approve → `pricing_lock.status='approved'`, `proposals.status='approved'`, audit row present.
  4. Attempt `update proposals set margin_pct = ...` via `supabase--insert` → expect exception "pricing locked by CFO approval".

### Files

Created:
- `supabase/migrations/<ts>_pricing_lock.sql`
- `src/lib/pricing-rules.ts`
- `src/components/proposals/PricingApprovalCard.tsx`

Modified:
- `src/lib/proposal.functions.ts` — add 3 RPCs + checklist types.
- `src/lib/proposal-query.ts` — add hooks/options.
- `src/routes/_authenticated/proposals.$proposalId.tsx` — mount the new card + pass `pricingLocked`.
- `src/components/proposals/ProposalHeaderForm.tsx`, `LineItemsGrid.tsx`, `ArrayConfigForm.tsx` — accept optional `pricingLocked` prop, render `Lock` icons on the three protected fields.
