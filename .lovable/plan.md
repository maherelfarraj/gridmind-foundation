## P-053 — Drawing register UI: revisions, status, markup viewer

Build the engineering drawing register (list + detail) with governed status transitions, revision uploads, and a canvas markup viewer. All mutations use `createServerFn` + zod + `requireSupabaseAuth`; RLS is second-layer. Design tokens only.

### 1. Server functions — `src/lib/drawings.functions.ts`

Roles: writers = `engineering_admin | engineer | project_admin` (+ super_admin). `company_admin`, `client_viewer`, `lender_viewer` = read-only (filtered UI-side; RLS already blocks writes).

- `listDrawings({ projectId, search?, discipline?, status?, limit=100, offset=0 })` — server-side filtered query on `drawing_register` joined to the current revision (`drawing_revisions` via `current_revision_id`) for `issued_at` + `revision_code`. Returns rows + `total`.
- `getDrawing({ drawingId })` — header + full revision timeline (ordered by `created_at`), each revision joined with `profiles` (issued_by / created_by names).
- `createDrawing({ projectId, drawingNumber, title, discipline })` — insert into `drawing_register`; unique (project_id, drawing_number) violation → 409 `drawing_number_taken`.
- `uploadDrawingRevision` — 2-step like site-data:
  - `getRevisionUploadUrl({ drawingId, fileName, fileSize, mimeType })` → signed upload URL at `drawings/{company_id}/{project_id}/drawings/{drawing_id}/{uuid}-{safeName}`; returns `suggestedRevisionCode` (next letter A→Z from existing revisions; if numeric scheme detected, next number).
  - `registerDrawingRevision({ drawingId, revisionCode, storagePath, fileName, fileSize, mimeType, issueReason? })` — inserts revision (status=`draft`), sets `drawing_register.current_revision_id`. Audit `drawing.revision_added`.
- `transitionDrawingStatus({ drawingId, revisionId, toStatus })` — enforces:
  - Allowed transitions: draft→IFD, IFD→IFC, IFC→as_built, any→superseded.
  - **IFC governance** (409 `ifc_requires_ifd_signoff`, clear message):
    1. At least one revision on this drawing has `status='IFD'` (either current or historical).
    2. All `document_markups` for revisions of this drawing where `status IN ('open','rejected')` — must be 0 (all resolved/accepted).
    3. A sign-off record exists: `approval_instances` row with `entity='drawing'`, `entity_id=drawing_id`, `status='approved'`.
  - On success: updates `drawing_revisions.status`, `drawing_register.current_status` (+ `locked=true` when IFC/as_built), sets `issued_by`/`issued_at` on the revision, writes `drawing.status_changed` audit with `{from, to, revision_id}`.
- `requestIfcSignoff({ drawingId, note? })` — creates `approval_instances` (entity='drawing', status='pending') if none pending; audit `drawing.signoff_requested`. (Writer role.)
- `decideIfcSignoff({ instanceId, decision: 'approved'|'rejected', comment? })` — role `engineering_admin | project_admin` only; updates instance + inserts `approvals` row; audit `drawing.signoff_decided`.
- `listMarkups({ revisionId })` / `createMarkup({ revisionId, pageNumber, annotation, reviewerOrg })` / `updateMarkupStatus({ markupId, status, resolutionNote? })` — status change gated to markup author OR `engineering_admin`; audit `drawing.markup_status_changed` on every update.
- `getDrawingFileUrl({ revisionId })` — 15-min signed URL from `drawings` bucket.

### 2. Query hooks — `src/lib/drawings-query.ts`

Query options + `useMutation` wrappers with cache invalidation (`['drawings', projectId, filters]`, `['drawing', drawingId]`, `['markups', revisionId]`).

### 3. Routes

- `src/routes/_authenticated/projects.$projectId.engineering.drawings.tsx` — add sub-nav entry (Overview / Site data / Drawings) in the engineering layout.
- `src/routes/_authenticated/projects.$projectId.engineering.drawings.index.tsx`
  - `validateSearch` (zod): `{ q?, discipline?, status?, page? }`.
  - `loaderDeps` → `ensureQueryData`.
  - Renders `DrawingRegisterTable` with toolbar, CSV export (client-side from current page rows), "New drawing" dialog.
- `src/routes/_authenticated/projects.$projectId.engineering.drawings.$drawingId.tsx`
  - Loader primes drawing + revisions.
  - Renders `DrawingDetail` (header + tabs: Revisions | Markups | Sign-off).

### 4. Components — `src/components/engineering/`

- `drawing-register-table.tsx` — table, filter toolbar (search debounced 300ms → URL search), discipline/status `Select`, status badge with token map (draft=muted, IFD=amber accent, IFC=primary, as_built=secondary, superseded=muted + line-through), skeleton/empty/error states, "New drawing" `Dialog`.
- `drawing-detail.tsx` — header card (number/title/discipline/status + `Lock` icon when `locked`), Tabs.
- `revision-timeline.tsx` — vertical timeline; per-revision: code, status badge, issue_reason, issued_by/at, download button (signed URL), "Set status →" menu (gated).
- `upload-revision-dialog.tsx` — dropzone (single file, 50MB, .pdf/.dwg/.dxf/.tif), auto-fills `suggestedRevisionCode`, XHR upload with progress, then `registerDrawingRevision`.
- `status-transition-dialog.tsx` — target-status picker; when IFC selected, shows checklist preview (IFD revision ✔, markups resolved ✔, sign-off ✔) with disabled confirm until all green; 409 toast on server rejection.
- `signoff-card.tsx` — request sign-off button + list of `approval_instances` for this drawing with decide controls (engineering_admin/project_admin).
- `markup-viewer.tsx` — canvas viewer:
  - Renders revision preview: PDF via `pdfjs-dist` (dynamic import, page 1) into a canvas; if mime is image, draws image. Fallback panel when neither.
  - Overlays markup pins from `annotation.coords` (relative x/y in [0,1]).
  - Click-to-add pin (writer roles) → opens comment popover → `createMarkup`.
  - Side panel: list with status chips + comment; author or engineering_admin can change status (Select) → audited.
- Read-only role detection via a small `useProjectRole(projectId)` hook (reads `user_roles` via existing profile query) — hides all edit affordances for `client_viewer` / `lender_viewer` / `company_admin`.

### 5. Dependencies

Add `pdfjs-dist` (dynamic-imported inside the viewer only, to keep it out of SSR).

### 6. Verification (Prairie Winds)

- Create GM-E-1001 (electrical) → upload rev A → transition to IFD.
- Attempt IFC with no sign-off → 409 `ifc_requires_ifd_signoff` toast with governance message.
- Add + resolve markups; request sign-off; decide `approved`; retry IFC → success; verify `drawing.status_changed` audit rows for draft→IFD→IFC.
- Upload second revision → dialog suggests "B"; timeline shows both with 15-min signed downloads.
- Filters + search hit server; `client_viewer` login shows zero edit controls.
- Markup status change → `drawing.markup_status_changed` audit row present.
- Set a drawing to `superseded` → row renders with strikethrough.

### Out of scope
- PDF multi-page navigation (page 1 only).
- Drag-repositioning pins (create/delete only).
- Markup threaded replies (single comment per markup for now).
- Bulk CSV of full register beyond current page.
