## P-096 — Commissioning Punch Closure Workflow

Build a project-scoped punch closure board that enforces multi-party signoffs per category and exposes a reusable `assertNoOpenCategoryAPunch` helper that P-097 (COD certificate) and P-099 (handover gate) will consume.

### Server (src/lib/commissioning-punch.functions.ts, new)

Create a dedicated module (kept separate from `qaqc.functions.ts` so the existing qaqc board's single-signoff flow is untouched):

1. `listCommissioningPunch({ project_id })` — returns `qaqc_punch_items` for the project joined with all `punch_signoffs` rows (party, signer_name, signed_at, evidence_path). Read roles: `construction_admin`, `foreman`, `project_admin`, `om_admin`, `company_admin`, `engineer`, `client_viewer`.
2. `closePunchItem({ punch_item_id, party, signer_name, evidence_path? })` — the write path.
   - Roles allowed: `construction_admin`, `foreman`, `project_admin`.
   - Loads the punch item, verifies `company_id` via `is_company_member` scoping (already enforced by RLS on the `context.supabase` client).
   - Insert into `punch_signoffs` with `onConflict('punch_item_id, signoff_party') ignoreDuplicates` — idempotent retry-safe (unique index already exists per migration 0044).
   - Recompute required parties from the punch row:
     - Every category → `contractor` required.
     - Category A → `contractor` + `client` required (+ `utility` when `utility_witness_required = true`).
     - Category B/C → `contractor` only.
   - Re-select existing signoff parties; if all required parties present and `status <> 'closed'`, update `status='closed'`, `closed_at=now()`, `closed_by=auth.uid()`.
   - Call `writeAuditLog('punch.closed','qaqc_punch_items', item_id, { category, signoffs })`.
   - Return `{ item, signoffs, closed: boolean, missing_parties: string[] }`.
3. `assertNoOpenCategoryAPunch({ project_id })` — exported reusable helper:
   - `select id, item_ref from qaqc_punch_items where project_id=... and category='A' and status <> 'closed'`.
   - If `count > 0` throw an error carrying `statusCode: 409`, message `punch_category_a_open`, and metadata `{ open_count, item_refs }`.
   - The project's error middleware already forwards numeric `statusCode`; verify by reproducing a 409 during the check step.

### Storage

Evidence upload uses the existing `closeout` bucket at `{company_id}/punch-evidence/{project_id}/{punch_item_id}/{uuid}-{filename}` (company UUID first per `storage_company_id` policy). Signed URLs are read via `context.supabase.storage.from('closeout').createSignedUrl`. No storage migration needed — bucket exists.

### UI — src/routes/_authenticated/projects.$projectId.commissioning.punch.tsx (new)

- Header KPI strip: per-category open/closed chips, overall closure %, and a red banner "COD blocked — N category A items open" whenever any A row is not `closed`.
- Legend strip explaining A/B/C semantics.
- Three-column Kanban lanes (A / B / C) with items showing `item_ref`, `title`, area, current signoff badges (contractor/client/utility), and evidence thumbnail if present.
- "Close" button on each open item opens a signoff dialog:
  - Party select (contractor / client / utility) — utility only visible when the item has `utility_witness_required`.
  - Signer name (required) + optional evidence upload (file → `closeout` bucket path above → path returned to the mutation).
  - Submits `closePunchItem`; on success invalidates the board query and shows a sonner toast ("Signoff recorded" vs "Punch item closed").
- Board states: skeleton loader, empty state ("No open punch items — ready for COD review"), error with retry button, optimistic close with rollback via `useMutation`.
- Add "Punch closure" link on the commissioning board header (`projects.$projectId.commissioning.tsx`) next to "Performance tests".

### Tests

- `tests/unit/punch-closure.rules.test.ts` — pure required-parties logic: A vs A+utility vs B vs C; idempotent duplicate handling; closure decision (all required present → close, missing → stay open).
- `tests/api/commissioning-punch.api.test.ts` (best-effort, matching existing stubs) — asserts `assertNoOpenCategoryAPunch` returns 409 with `open_count`/`item_refs`, and passes once A items are closed.

### Explicitly out of scope

- No changes to existing `qaqc.functions.ts` signoffPunchItem / `qaqc.punch.$id.tsx` flow (P-090's single-signoff walk stays as-is).
- No migrations required — 0044 already provides `punch_signoffs`, `utility_witness_required`, unique index, and RLS.
- No COD certificate UI — that lands in P-097 and consumes `assertNoOpenCategoryAPunch`.

### Verification checklist

- Category A item: close with contractor only → item stays open with `missing_parties: ['client']`; add client signoff → status flips to `closed`.
- Duplicate signoff submission → no duplicate row, no error surfaced to the user (idempotent).
- `assertNoOpenCategoryAPunch` throws 409 with item refs while any A open; returns cleanly once closed.
- Red banner + KPI chips update live after each mutation.
- Evidence lands at `{company}/punch-evidence/{project}/...`; audit log has `punch.closed` with category and signoff parties.
