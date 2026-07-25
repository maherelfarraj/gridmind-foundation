## P-111 — Approval Rules Engine

Upgrade P-040's minimal `approval_instances` / `approvals` tables into a full engine with threshold rules, sequential chains, per-step SLAs, audit triggers, and four RPCs. Add a company_admin rules-admin UI. Wiring into existing PO/proposal/gate/contract flows is deferred (this ticket ships engine + admin only).

### Current state (verified)
- `approval_instances` / `approvals` exist with the minimal P-040 shape and status CHECKs shown in the spec — the alter/drop-constraint idempotency will apply cleanly.
- `approval_rules` / `approval_chain_steps` don't exist yet.
- `app_role` enum includes every role the spec references (`finance_admin`, `legal_admin`, `company_admin`, `client_viewer`, `investor_viewer`, `lender_viewer`, etc.).
- `project_phase_gates.approval_instance_id` already FKs into `approval_instances` — the ALTER path preserves it.

### Deliverables

**1. Migration `supabase/migrations/0052_approval_engine.sql`**
- Parts 1–4 verbatim from the spec: `is_external_viewer()` helper; `approval_rules` + `approval_chain_steps`; `create table if not exists` + `alter … add column if not exists` upgrades for `approval_instances` / `approvals`; drop/recreate status CHECKs; RLS enabled + idempotent `drop policy if exists`/`create policy` set; `set_updated_at` triggers; `audit_approval_changes` trigger writing to `audit_logs`; seed rules + chain steps with `on conflict do nothing`; indexes; grants (revoke `escalate_overdue_approvals` from public/anon/authenticated, grant to `service_role`; grant the three user-callable RPCs + `is_external_viewer` to `authenticated`).

**2. Four RPCs (SECURITY DEFINER, `set search_path = public`)**
- `start_approval_instance(rule_key, entity_type, entity_id, amount, metadata jsonb)` → looks up active rule for caller's company; returns `null` when no rule or `amount ≤ threshold_amount`; returns existing open (`pending`/`in_progress`) instance id for `(entity_type, entity_id)` if present; else inserts instance (`current_step=1`, `sla_due_at = now() + step-1 sla_hours` falling back to rule `sla_hours`), plus step-1 `approvals` rows for every `user_roles` holder of the step role in the company. Fallback: if no holders, create rows for all `company_admin`s. Returns the instance id.
- `decide_approval(approval_id, decision, comment)` → decision in `('approved','rejected')`; caller must own the approval row; `comment` required on reject (raise `comment_required_on_reject`); idempotent re-click on same decision returns silently. On reject: mark row rejected, mark any remaining pending peers `skipped`, mark instance `rejected` + `decided_by`/`decided_at`/`completed_at`. On approve: mark row approved; if peers still pending, set instance `in_progress` and stop; else if a next chain step exists, bump `current_step`, insert fresh approver rows for that role (same fallback) with fresh `sla_due_at`; else mark instance `approved` + completion stamps. Legacy rule-less instances (no `rule_id`) complete on first approve.
- `cancel_approval_instance(instance_id)` → allowed for `requested_by` or `company_admin`; only when status in `('pending','in_progress')`; marks instance `cancelled`, skips all pending approvals.
- `escalate_overdue_approvals()` → service_role only; finds pending/in_progress instances past `sla_due_at` whose `metadata->>'escalated_at'` is null; stamps `metadata = metadata || jsonb_build_object('escalated_at', now())` and writes an `approval.escalated` row into `audit_logs`. Cron wiring is B13/P-123, not this ticket.

**3. Zod-validated server functions in `src/lib/approvals.functions.ts`**
- `startApprovalInstance`, `decideApproval`, `cancelApprovalInstance` — thin `supabase.rpc(...)` wrappers behind `requireSupabaseAuth`; no direct table writes.
- `listApprovalRules`, `upsertApprovalRule`, `toggleApprovalRule`, `deleteApprovalRule`, `setApprovalChainSteps` — company_admin-only CRUD (verified via `has_company_role('company_admin')` inside handler using `context.supabase`); each mutation calls `write_audit_log`.

**4. Admin UI `src/routes/_authenticated/settings.approval-rules.tsx`**
- Company_admin gate (hide/redirect otherwise); tokens-only styling.
- Rules table: name, entity_type, threshold (currency-formatted), SLA hours, `is_active` switch, edit/delete row actions.
- Rule form (dialog, react-hook-form + zod): name, description, entity_type (select of the seeded entity types + free text), threshold_amount + threshold_currency, sla_hours, escalation_role, blocks_export toggle.
- Chain-step editor inside the rule dialog: ordered list of `{step_order, role, sla_hours?}` with add / remove / reorder (↑↓); saved atomically via `setApprovalChainSteps` (delete-then-insert inside a single RPC to avoid orphan step numbers).
- Sonner toasts, skeleton loading, empty state ("No approval rules yet"), error state with retry.
- Add nav entry under Settings.

**5. Types regeneration**
- Regenerate `src/integrations/supabase/types.ts` after migration approval (auto-managed).

### Explicitly out of scope (later tickets)
- Wiring `start_approval_instance` into PO/proposal/gate/contract/change-order flows — the spec's "wiring note" says keep legacy inline fallbacks and revisit later.
- Approval inbox / SLA countdown UI — P-112.
- Cron trigger for `escalate_overdue_approvals` — B13/P-123.

### Verification checklist (spec's ✅ block)
Run after migration approval:
1. Migration applies clean, re-runs as no-op.
2. `start_approval_instance('po_threshold_finance', 'purchase_order', <uuid>, 60000, '{}')` → returns instance id with finance_admin approver rows and `sla_due_at ≈ now()+48h`; amount 40000 → `null`; second identical call → same instance id.
3. Contract chain: legal_admin approve step 1 → step-2 finance_admin rows appear with fresh SLA → finance approve → instance `approved`.
4. Reject without comment → `comment_required_on_reject`; with comment → instance `rejected`, peers `skipped`.
5. `client_viewer` SELECTs see only own/assigned approvals.
6. `/settings/approval-rules` CRUD works as company_admin, hidden otherwise; audit rows written.
7. Existing P-040 gate approvals remain readable.
