## P-060 — IFC release ceremony

Wires the drawing pipeline (P-053), review governance (P-058), and phase-gate engine (P-040) into a formal Issued-for-Construction release.

### 1. Migration `0023_ifc_releases.sql`

- `public.ifc_releases` — `company_id`, `project_id`, `package_name`, `revision_snapshot jsonb` (array of `{drawing_id, revision_id, drawing_number, revision_code, discipline}`), `status text default 'prepared' check in ('prepared','released','void')`, `prepared_by`, `released_by`, `released_at`, `distribution_list jsonb default '[]'`, timestamps, `updated_at` trigger.
- `public.ifc_release_signoffs` — `release_id references ifc_releases on delete cascade`, `signer_id`, `role_label text check in ('Lead Engineer','Engineering Manager','Project Director')`, `signature_text`, `signed_at`, unique `(release_id, signer_id)` and unique `(release_id, role_label)`.
- Grants to `authenticated` and `service_role`; RLS on:
  - `select` — `is_company_member(company_id)`
  - `insert/update` — `has_role(auth.uid(),'engineering_admin') or has_role(auth.uid(),'project_admin')`
  - `delete` blocked (void via status update)
- Backfill: append `{key:'design_freeze', label:'Design freeze — IFC package released', required:true, done:false}` to every existing `project_phase_gates` row where `phase='development'` and the key is missing.
- Update the project template seed (project bootstrap) so newly created Development gates include the same item.
- Index `ifc_releases(project_id, status)` and `ifc_release_signoffs(release_id)`.

### 2. Server functions — `src/lib/ifc-release.functions.ts`

All use `attachSupabaseAuth` + `requireSupabaseAuth`; writes gated by `assertIfcAdmin(context)` (engineering_admin OR project_admin, same pattern as gates).

- `listIfcReleases({projectId})` — releases with signoff counts.
- `getIfcRelease({releaseId})` — release row + signoffs + signer names for detail/certificate view.
- `listReleasableDrawings({projectId})` — drawings whose latest revision is IFD with a completed review round and zero open/rejected markups; returns `{eligible: Drawing[], blocked: {drawing, reasons[]}[]}` reusing the same rules `transitionRevisionStatus` enforces in `drawings.functions.ts` (extracted to `src/lib/ifc-rules.ts`).
- `prepareIfcRelease({projectId, packageName, drawingIds, distribution})` — validates each drawing via the shared rule; snapshots current revision id + code + discipline; inserts `ifc_releases` row `prepared`; returns `id`. On any blocked drawing → 409 with per-drawing reasons.
- `signIfcRelease({releaseId, roleLabel, signatureText})` — server verifies typed name equals caller's profile full name (case-insensitive trim); upserts on `(release_id, role_label)`; audit `engineering.ifc_signed`.
- `releaseIfc({releaseId})` — guards: status `prepared`, signoffs present for `Lead Engineer` + `Engineering Manager` (Project Director optional). Transactionally:
  1. For each snapshot drawing: set `drawing_register.current_status='IFC'`, `locked=true`, `current_revision_id=snapshot.revision_id`; set matching `drawing_revisions.status='IFC'`.
  2. Update release: `status='released'`, `released_by`, `released_at`.
  3. Toggle `design_freeze` checklist item on the project's Development gate (only when currently `open` or `in_review`) — mirrors `toggleGateChecklistItem` logic inline to avoid privileged escalation.
  4. `write_audit_log('engineering.ifc_released', ...)` with full snapshot + signer roster.
- `voidIfcRelease({releaseId, reason})` — only while `prepared`; audit `engineering.ifc_voided`.
- `notifyDistribution({releaseId})` — inserts one `notifications` row per `distribution_list[*].profile_id` (kind `ifc_released`, payload with package name); audit `engineering.ifc_distributed`.
- `getIfcKpis({projectId})` — returns `{design_cycle_days: firstIfdCreatedAt → latestReleasedAt, change_orders_after_ifc: count of revisions on locked drawings created after release}` for future dashboards.

The existing drawing-lock guard in `drawings.functions.ts` already returns 409 when `locked` is true — no change needed for the "post-release edits rejected" check.

### 3. Query hooks — `src/lib/ifc-release-query.ts`

`ifcReleaseListQueryOptions`, `ifcReleaseDetailQueryOptions`, `releasableDrawingsQueryOptions`, plus `usePrepareIfcRelease`, `useSignIfcRelease`, `useReleaseIfc`, `useVoidIfcRelease`, `useNotifyDistribution`. Invalidates `['ifc-releases', projectId]`, `['drawings', projectId]`, and `['gates', projectId]` on success.

### 4. UI

Route `src/routes/_authenticated/projects.$projectId.engineering.ifc-release.tsx` — three-column layout with list on the left, wizard/detail on the right.

- Sub-nav entry added: `{ to: "ifc-release", label: "IFC release" }` in `projects.$projectId.engineering.tsx` (`SUB_TABS` and the union type).
- Empty state: "Prepare your first IFC package".
- List: package name, status badge, prepared/released timestamps, drawing count, click → detail.
- Wizard component `IfcReleaseWizard.tsx` (steps: Package → Drawings → Distribution → Review):
  - **Package**: name + optional notes.
  - **Drawings**: table from `listReleasableDrawings`; eligible checkable, blocked rows show inline reasons with an "IFC blocked" chip.
  - **Distribution**: member picker (reuses `listRoutableMembers` from RFI module) building `[{profile_id, org, email}]`.
  - **Review**: summary + "Prepare release" → creates row with status `prepared`.
- Detail component `IfcReleaseDetail.tsx`:
  - Package header, revision snapshot table, distribution list.
  - `SignoffPanel.tsx`: for each required role, if caller matches role's admin group and hasn't signed, form asking to type full name; server validates match. Shows signed roster with timestamps.
  - "Release now" button (engineering_admin only, disabled until required signoffs present); "Void" button while `prepared`.
  - Once released: "Notify recipients" and "Open certificate" buttons.
- Certificate view `src/routes/_authenticated/projects.$projectId.engineering.ifc-release.$releaseId.certificate.tsx` — printable (Tailwind `print:` classes, hidden nav), shows package, revisions table, signers with typed name and `signed_at`, released_by/at, distribution list; "Print" button uses `window.print()`.

All copy uses design tokens; sonner toasts on mutations; role-gated buttons; skeletons per Suspense boundary; branded 404/error components.

### 5. Governance verification (post-build)

Reproduce the manual checklist against Prairie Winds:

- Drawing lacking a completed review round → wizard "Drawings" step lists reason "no review round completed".
- Sign as Lead Engineer + Engineering Manager → both rows appear signed with timestamps.
- Release without signoffs → 409 `signoff_missing`; with signoffs → drawings locked, `current_status='IFC'`, audit `engineering.ifc_released` with snapshot.
- Attempt drawing edit after release → existing 409 `drawing_locked`.
- Development→NTP gate: `design_freeze` item shows `done=true, done_by=released_by, done_at=released_at`; gate can now progress.
- Certificate route renders and prints cleanly.

### Technical notes

- Signature verification: `profiles.full_name` compared with `.trim().toLowerCase()` equality; reject with 400 `signature_mismatch`.
- Snapshot is the source of truth — release ignores later revisions until voided or superseded.
- All drawing/revision updates in `releaseIfc` are sequential Supabase calls guarded by pre-checks; there is no cross-table transaction in Supabase JS, so on partial failure we roll forward by re-issuing the call — acceptable because each individual update is idempotent (`locked=true, status='IFC'` on already-locked drawings is a no-op).
- Reuses existing `notifications` table from P-058 for distribution.
- No new packages required.
