## P-114 — Portal memberships + client portal shell

Ship the client/investor/lender portal on top of `portal_memberships` with SECURITY DEFINER RPCs as the ONLY data path. Admins manage members from `/settings/portal-members`; external viewers land at `/portal`.

### 1. Migration `supabase/migrations/0054_portal_memberships.sql`

Apply the SQL verbatim from the spec:

- Tables: `portal_memberships` (unique on `company_id, project_id, email`; conditional FK to `projects` via `to_regclass` guard) and `portal_tickets`.
- RLS enabled on both. Policies exactly as specified — external viewers can only see their own membership/tickets; admins manage; ticket insert requires active membership when caller is an external viewer.
- Triggers wire `set_updated_at`; indexes on `(user_id,status)`, `(company_id,project_id)`, `(company_id,project_id,status)`.
- GRANTs to `authenticated` per spec.
- Add `portal_audit_events` table (id, company_id, project_id, membership_id, actor_id, event, metadata jsonb, created_at) with RLS: admins select; writes only via SECURITY DEFINER RPCs. Grant select to authenticated members / self; insert to service_role only.

### 2. SECURITY DEFINER RPCs (same migration)

All `security definer`, `set search_path = public`, `grant execute … to authenticated`.

- **`portal_assert_access(p_project_id uuid) returns public.portal_memberships`** — selects active, unexpired row for `auth.uid()` + project; raises `portal_access_denied` (SQLSTATE 42501) otherwise; updates `last_seen_at = now()`.
- **`portal_get_feed(p_project_id uuid) returns jsonb`** — calls `portal_assert_access`; builds jsonb `{ project, exposure, milestones, kpis, photos, documents, financials, tickets }` — each section only when the corresponding exposure flag is true, and each source table wrapped in `to_regclass('public.<table>') is not null` so it degrades gracefully before later batches. Milestones from `project_phase_gates` (curated fields: phase, status, planned/actual dates). Photos from `site_photos` (path, caption, taken_at — signed via UI). KPIs from `evm_snapshots` most-recent row (spi, cpi, pv, ev, ac). Documents/financials only rendered as empty scaffolding for now (exposure defaults false). If `portal_audit_events` exists, insert `portal.feed_viewed`.
- **`portal_raise_ticket(p_project_id, p_subject, p_body, p_category, p_priority)`** — asserts access; requires `exposure->>'tickets' = 'true'` else raises `portal_exposure_denied`; inserts ticket with `raised_by = auth.uid()`, `membership_id` from assertion; audits `portal.ticket_raised`; returns ticket id.
- **`portal_decide_approval(p_approval_id uuid, p_decision text, p_comment text)`** — loads approval → instance; requires `approvals.approver_id = auth.uid()` AND active membership on the instance's project; calls existing `public.decide_approval`; audits `portal.approval_decided` with `metadata = jsonb_build_object('via','portal','decision',p_decision)`.

### 3. Server functions & hooks (`src/lib/portal.functions.ts`, `portal.hooks.ts`)

Thin `createServerFn` wrappers (all with `attachSupabaseAuth`) — never query source tables directly.

- `getPortalMemberships()` — caller's own active memberships, projected `{ project_id, project_name, company_name, role, exposure, expires_at, last_seen_at }`.
- `getPortalFeed({ projectId })` → `rpc('portal_get_feed')`.
- `getPortalPhotoSignedUrl({ projectId, path })` — asserts access via `portal_assert_access`, then issues a short-lived signed URL from the `photos` bucket.
- `getPortalApprovals({ projectId })` — filters `approvals` to `approver_id = uid` on instances belonging to `projectId`; joined by instance metadata. Uses RLS-safe query (approvals already have per-user RLS).
- `raisePortalTicket(...)` / `listPortalTickets({ projectId })` (own tickets only).
- `decidePortalApproval({ approvalId, decision, comment })` — comment required when `decision='rejected'`.

Admin:
- `listPortalMembers({ projectId })` — admin-only via `has_company_role`.
- `invitePortalMember({ projectId, email, role, exposure, expiresInDays=7 })` — calls existing `create_invite` RPC for the role, then upserts a `portal_memberships` row `status='invited'`, `invite_id`, `expires_at = now() + 7d`. Writes audit `portal.member_invited`.
- `suspendPortalMember({ id }) / revokePortalMember({ id })` — flip status; audit `portal.member_suspended` / `portal.member_revoked`.
- `updatePortalMemberExposure({ id, exposure })`.

Extend `redeem_invite` flow (client side in existing `accept-invite.tsx`): after redemption, if a matching pending `portal_memberships` row exists for that email, stamp `user_id`, `accepted_at`, `status='active'`.

### 4. Admin UI — `/settings/portal-members`

`src/routes/_authenticated/settings.portal-members.tsx`. Gated to `company_admin` / `project_admin`.

- Project selector (persisted in search param).
- Table: email · role · status badge · exposure chip row (toggle-able inline; saves via `updatePortalMemberExposure`) · last_seen (relative) · expires_at.
- Row actions: Suspend / Revoke / Reinvite (regenerates token, 7 days).
- "Invite portal member" dialog: email, role (client/investor/lender viewer), exposure checkboxes with sane defaults, expiry preview ("Invite expires {date}").
- Empty state, skeletons, toast on success.

### 5. Portal shell

Top-level (not under `_authenticated` app shell). Own layout with **only** a top bar (company brand from `company_branding` + user menu) — no internal sidebar.

- `src/routes/portal.tsx` — layout route. Verifies session; if none → `/auth?redirect=/portal`. Renders `<PortalTopBar />` + MFA banner + `<Outlet />`.
- `src/routes/portal.index.tsx` — project picker from `getPortalMemberships()`. Empty state "No shared projects yet".
- `src/routes/portal.projects.$projectId.tsx` — layout with tab nav (Overview / Milestones / Photos / Approvals / Tickets); calls `getPortalFeed` once and passes via route context. Catches `portal_access_denied` → branded "Access expired or revoked" page.
- Tab leaves as child routes under `portal.projects.$projectId.<tab>.tsx`:
  - **Overview**: project card + KPI tiles (SPI/CPI/PV/EV/AC) when `exposure.kpis`.
  - **Milestones**: read-only timeline from feed.
  - **Photos**: responsive grid, lazy-load images via `getPortalPhotoSignedUrl`; only rendered when `exposure.photos`.
  - **Approvals**: caller-assigned pending approvals list; decide dialog reuses the same comment-required-on-reject pattern as `/approvals`, calls `decidePortalApproval`.
  - **Tickets**: raise form (subject/body/category/priority) + own ticket list with status badges (only when `exposure.tickets`).

States everywhere: skeletons, curated empty states ("Nothing shared yet"), error boundary with retry.

MFA banner: dismissible amber banner on `/portal` when `user.factors` does not include a verified TOTP. Copy: "For your security, enable two-factor authentication on your account." Link → `/portal/security` (thin stub calling `supabase.auth.mfa.enroll`).

### 6. Auth attacher / route guards

- Portal routes reuse the existing Supabase session; no new middleware.
- All portal server fns use `attachSupabaseAuth`; RPCs enforce membership.
- UI code MUST NOT query `site_photos`, `project_phase_gates`, `projects`, `evm_snapshots` directly — everything through portal server fns. Add a lint-doc comment in `portal.functions.ts` and a matching README note under `docs/portal.md`.

### 7. Tests

- `tests/rls/portal_memberships.test.ts` — unauthenticated & non-member cannot read; member can only read their own row.
- `tests/api/portal_rpcs.test.ts` — matrix:
  - unauthenticated → `portal_access_denied`
  - member with `exposure.photos=false` → feed has no `photos` key
  - suspended member → assertion fails
  - ticket raise blocked when `exposure.tickets=false`
  - approval decide only succeeds for assigned approver with active membership
- `tests/unit/portal.exposure.test.ts` — helper that projects the exposure jsonb.

### 8. Acceptance checklist (from the spec)

- [ ] Invite → accept → membership flips `active`, `user_id` / `accepted_at` stamped.
- [ ] `exposure.photos=false` → photos absent from RPC output (not just hidden client-side).
- [ ] Non-member → `portal_access_denied`; direct table selects return zero rows under RLS.
- [ ] Suspend → immediate lockout, "Access expired or revoked" page renders.
- [ ] Portal approval decision writes `portal.approval_decided` with `via:'portal'`.
- [ ] Ticket raise only when `exposure.tickets=true`; audited.
- [ ] Portal shell has NO internal sidebar; MFA banner visible until enrolled.

### Notes / open assumptions

- Milestones source = `project_phase_gates` (existing schema). If a dedicated `milestones` table lands later, swap inside `portal_get_feed` without touching UI.
- KPI source = latest `evm_snapshots` row per project; empty state when none.
- `portal_audit_events` is new; guarded by `to_regclass` so RPCs keep working if a future migration renames it.
- No email delivery for invites here (existing `create_invite` returns a token; admin UI shows a copy-link the same way current invite flow does).
