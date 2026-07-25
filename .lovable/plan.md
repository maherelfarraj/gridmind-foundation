## P-112 — Approval Inbox + SLA Countdowns + Escalation Cron

Ship the `/approvals` workspace that consumes the P-111 engine RPCs, plus a service-role-guarded cron endpoint for `escalate_overdue_approvals`.

### Files

1. **`src/lib/approvals.inbox.functions.ts`** — new server fns (all `requireSupabaseAuth`, zod-validated, DTO-only):
   - `listMyApprovals({ tab: "pending" | "decided" | "all" })` — joins `approvals` → `approval_instances`; Pending = `approver_id = auth.uid() AND status='pending'` ordered by `sla_due_at asc`; Decided-by-me = my rows with status in approved/rejected/skipped; All = `company_admin`-only fleet view. Enrich each row with instance metadata, requester profile display name, chain step (current + total), and `escalated_at` flag. Returns compact rows for the list.
   - `getApprovalInstance({ instanceId })` — full chain (all approvals grouped by step with approver profile + decision timestamps), instance metadata, and `audit_logs` where `entity='approval_instances' AND entity_id=instanceId`, newest first.
   - `getMyPendingCount()` — cheap count for the sidebar badge (refetch every 60 s).
   - `decideApproval({ approvalId, decision, comment })` wraps the P-111 `decide_approval` RPC; enforce comment on reject server-side too.

2. **`src/routes/_authenticated/approvals.tsx`** — inbox route:
   - `ApprovalInbox` with shadcn `Tabs` — Pending / Decided by me / All (All hidden unless `has_company_role('company_admin')`, gated by `canManageApprovalRules`-style helper).
   - Each row: entity-type `Badge`, title from `metadata.title` (fallback `${entity_type} ${slice(entity_id,0,8)}`), requester, "Step {n}/{total} — {role}", `Intl.NumberFormat` amount when present, SLA countdown badge with 3 tiers (muted / `bg-accent` / `bg-destructive`) computed with `date-fns/formatDistanceToNowStrict`, and "Escalated" badge when `metadata.escalated_at` is set. Company_admin All-tab pins escalated rows to the top.
   - `ApprovalDetailDrawer` (shadcn `Sheet`) fetched via `getApprovalInstance`: chain stepper (done ✓ with approver + timestamp, current highlighted, future muted), entity deep-link renderer that maps entity_type→route (e.g. `/procurement/pos/$id`) and falls back to plain text when no route registered, full comment history, and audit trail.
   - `DecideDialog` — comment textarea, Reject requires non-empty (`disabled` submit until then), optimistic remove from Pending via `queryClient.setQueryData` with rollback on error, `sonner` toasts, invalidates pending-count + inbox + `["approvals","instance",id]` on success.
   - Skeleton / empty ("You're all caught up ☕") / error-with-retry on every panel.

3. **`src/routes/api/cron/approval-escalations.ts`** — POST-only server route. Reads `process.env.CRON_APIKEY` inside handler, checks `apikey` header with `timingSafeEqual`, 401 otherwise. Loads `supabaseAdmin` via `await import("@/integrations/supabase/client.server")` and calls `.rpc("escalate_overdue_approvals")`. Returns `{ escalated: number }`. `// TODO(B13/P-123): wrap with guardPublicHook`.

4. **`src/lib/nav-map.ts`** — add `{ moduleKey: "workspace", label: "Approvals", url: "/approvals", icon: Inbox }` visible to all internal roles. External viewer roles (`client_viewer`, `investor_viewer`, `lender_viewer`) already route to `/portal`; the nav item guard filters them out here.

5. **`src/components/app-sidebar.tsx`** — attach the live pending-count `Badge` next to the Approvals item using `getMyPendingCount` (60 s `refetchInterval`, `staleTime: 30_000`). Hide item when the user's only roles are the three external viewer roles.

6. **Secret** — generate `CRON_APIKEY` via `secrets--generate_secret` (32 chars). Not exposed to browser.

### RLS / data access

- All reads through `requireSupabaseAuth` → RLS already restricts `approvals` / `approval_instances` / `audit_logs` to company members. No new policies needed.
- `escalate_overdue_approvals` remains callable only by `service_role` (grants set in P-111 migration); cron endpoint uses `supabaseAdmin`.

### Verification

- Typecheck (`bunx tsgo --noEmit`).
- psql check: create synthetic pending approvals with varied `sla_due_at`, confirm ordering + overdue bucket; POST cron without apikey → 401, with apikey → escalates + writes `approval.escalated` audit rows.
- Manual smoke via preview: pending badge updates after decide; reject-without-comment disabled; company_admin sees All tab; external viewer role sees no nav item.

### Out of scope (deferred)

- Real HMAC + IP allowlist on cron → B13/P-123.
- Entity deep-link routes that don't yet exist stay plain text.
- pg_cron schedule wiring lands with the guarded endpoint in B13.
