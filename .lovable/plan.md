## P-058 — Drawing review workflow (IFD → reviewers → sign-off → IFC gate)

### Migration `0021_drawing_reviews.sql`

Three tables, standard tenant columns (`id`, `company_id`, `created_at`, `updated_at` where applicable), `set_updated_at()` triggers, indexes, GRANTs, RLS.

1. `drawing_review_rounds`
   - `revision_id` → `drawing_revisions(id)` on delete cascade
   - `project_id`, `round_no` int (1-based per revision), `status` ('open' | 'closed' | 'waived'), `due_date`, `created_by`
   - unique `(revision_id, round_no)`
   - RLS: SELECT `is_company_member`; INSERT/UPDATE `has_role(auth.uid(),'engineering_admin')` OR `has_role(...,'project_admin')`
2. `drawing_review_signoffs`
   - `round_id` → cascade; `reviewer_id` → `profiles(id)`; `reviewer_org` ('client'|'lender'|'utility'|'internal'); `decision` nullable ('approved'|'approved_with_comments'|'rejected'|'waived'); `comment`; `signed_at`
   - unique `(round_id, reviewer_id)`
   - RLS: SELECT company member; INSERT by engineering_admin/project_admin (round creation); UPDATE where `reviewer_id = auth.uid()` OR engineering_admin (waiver path)
3. `notifications` (minimal — full UI in Batch 12)
   - `user_id` → `profiles(id)`, `type`, `title`, `body`, `link`, `read_at`
   - RLS: SELECT/UPDATE `user_id = auth.uid()`; INSERT allowed to any authenticated (server functions write on behalf of users)

### Server logic — `src/lib/drawing-reviews.functions.ts`

All `.middleware([attachSupabaseAuth])`, zod-validated, tenant-scoped via loaded revision/project row.

- `listReviewRounds({ projectId })` — rounds joined with revision (drawing number, rev code), reviewers, decision chips, markup open/resolved counts (aggregate `document_markups` by revision).
- `getReviewRound({ roundId })` — round + signoffs + reviewer profile display names + markup summary + audit chip data.
- `listEligibleReviewers({ projectId })` — company members with roles `client_viewer`, `lender_viewer`, or internal engineering roles (`engineer`, `engineering_admin`, `project_admin`).
- `startReviewRound({ revisionId, reviewerIds: [{userId, org}], dueDate })` — engineering_admin/project_admin only; requires revision status `IFD`; supersedes any existing open round on same revision (mark closed) then creates round with `round_no = max+1`; inserts signoff rows with `decision = null`; inserts `notifications` rows (`type='drawing_review.requested'`, link to drawing); audit `engineering.review_round_started`.
- `submitSignoff({ signoffId, decision, comment })` — only the named reviewer; `decision` in `approved | approved_with_comments | rejected`; sets `signed_at`; audit `engineering.review_signoff`; on final signoff auto-close round.
- `waiveSignoff({ signoffId, comment })` — engineering_admin only; requires non-empty comment (409 otherwise); sets `decision='waived'`, `signed_at=now()`, audit `engineering.review_waived`.
- `closeReviewRound({ roundId })` — engineering_admin/project_admin; only when all signoffs have `decision != null`; audit `engineering.review_closed`.

### IFC governance update — `src/lib/drawings.functions.ts`

Replace the existing "approved engineering sign-off" check inside `transitionDrawingStatus` when `toStatus === 'IFC'`:

- Locate the latest IFD revision on the drawing.
- Load the most recent review round for that revision.
- Reject 409 `ifc_blocked_no_review` when no round exists.
- Reject 409 `ifc_blocked_pending_reviews` when any signoff row has `decision IS NULL`.
- On success, auto-close the round (idempotent) before performing the status transition.

Existing "no open markups" and "must have IFD" checks stay. Update the error copy to match the new contract.

### UI — `src/routes/_authenticated/projects.$projectId.engineering.reviews.tsx`

Add "Reviews" tab to engineering sub-nav (`projects.$projectId.engineering.tsx`).

Sections:
- **Rounds list** (`ReviewRoundsTable`): per project — drawing number + rev, round #, status badge, reviewers as decision chips (color per decision), due-date countdown, overdue → amber badge when `due_date < today && status='open'`. Row click opens drawer.
- **Round detail drawer** (`ReviewRoundDrawer`): revision info, markup summary (open / resolved counts), signoff timeline (reviewer, org, decision chip, comment, signed_at), inline actions:
  - reviewer's own row → decision + comment form (submit via `submitSignoff`)
  - engineering_admin → "Waive" per pending row (comment required — client-side + server-side validation)
  - engineering_admin / project_admin → "Close round" when complete
- **Start round dialog** (`StartReviewRoundDialog`) triggered from drawing detail (P-053) header when `revision.status === 'IFD'` and from Reviews tab header: multi-select reviewers from `listEligibleReviewers` with org selector per reviewer, due date picker.

States: skeleton via TanStack Query `useSuspenseQuery`, empty (`No review rounds yet — start one from an IFD revision`), error boundary. Optimistic mutation for signoff + sonner toast. Semantic tokens only. All copy respects role (view-only for non-writers).

### Query layer — `src/lib/drawing-reviews-query.ts`

`useReviewRounds(projectId)`, `useReviewRound(roundId)`, `useEligibleReviewers(projectId)`, plus mutations invalidating `['review-rounds', projectId]`, `['review-round', roundId]`, `['drawing', drawingId]` (for the IFC gate refresh).

### Tests — `tests/unit/`

- Sign-off completeness helper (pure): `roundIsComplete(signoffs)` — used by both server and UI.
- Governance error mapper: input scenarios → status/code.

### Acceptance checklist

- [ ] Start round on IFD rev with two reviewers → rows + notifications inserted
- [ ] IFC transition returns 409 while any signoff pending
- [ ] Reviewer can only sign own row; other row returns 403
- [ ] Engineering_admin waive without comment → 409; with comment → 200 + audited
- [ ] All decisions filled → IFC transition succeeds and round auto-closes
- [ ] Overdue open round → amber badge in list

### Out of scope (Batch 12 / P-111)

Full notifications UI (bell/menu), background overdue sweeper, and the generic approvals engine — this ticket adds only the minimal `notifications` table row-writes.

next → P-059 once green.
