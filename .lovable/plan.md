## P-090 — QA/QC punch items

Append the `qaqc_punch_items` table to migration `0042_qaqc.sql` (part 2), then build the punch-list UI: category board, rapid punch-walk capture, and role-gated signoff.

### 1. Migration — append to `supabase/migrations/0042_qaqc.sql`

Add exactly the SQL from the spec (guarded enums `punch_category` A/B/C and `punch_status` open/ready_for_review/closed/void; `qaqc_punch_items` table; RLS SELECT via `is_company_member`; write policy for construction_admin / foreman / field_technician / company_admin; GRANT select/insert/update to authenticated; `punch_project_status_idx`).

Plus (to match project conventions used across 0042 part 1):
- `create trigger trg_qaqc_punch_updated_at before update on public.qaqc_punch_items for each row execute function public.set_updated_at();`

### 2. Domain logic — `src/lib/qaqc.rules.ts` (extend)

Add:
- `PUNCH_CATEGORIES = ['A','B','C']` with `PUNCH_CATEGORY_LABELS` (A = before COD/energization, B = before handover, C = cosmetic).
- `PUNCH_STATUSES = ['open','ready_for_review','closed','void']` + display labels + tint tokens.
- Zod schemas: `punchInput` (create — projectId, walkDate, area, discipline, category, description, dueDate?, assignedTo?, photoIds[]); `punchUpdateInput`; `punchSignoffInput` (id + typed `signoffName` min 2 chars).
- `nextPunchNumber(seq)` → `PN-0001` style formatter.
- Helper `canSignoff(roles)` → true only for construction_admin/company_admin.

### 3. Server functions — `src/lib/qaqc.functions.ts` (extend)

- `listPunchItems({ projectId?, category?, status?, discipline?, area?, search? })` — reads `qaqc_punch_items` joined to `projects(name,code)` and `profiles` (raised_by, assigned_to email); returns rows scoped by RLS.
- `getPunchItem(id)` — detail with joined names + photo signed URLs derived from `site_photos` referenced by `photo_ids`.
- `createPunchItem(input)` — resolves company, generates `PN-####` per-company with 5-retry unique-violation loop (mirrors inspection numbering), inserts with `raised_by=userId`, writes audit `punch.create`. Idempotency-friendly.
- `updatePunchItem(input)` — patch fields, audit `punch.update`.
- `markPunchReady(id)` — sets `status='ready_for_review'`, audit `punch.ready`.
- `signoffPunchItem({ id, signoffName })` — server-side role check via `has_role`/`has_company_role` RPC; only construction_admin or company_admin succeed (throws `forbidden_role` otherwise). Updates `status='closed'`, `signoff_by=userId`, `signoff_name`, `signoff_at=now`, `closed_at=now`. Audit `punch.signoff`. Rejects unless current status is `ready_for_review`.
- `voidPunchItem({ id, reason })` — construction_admin/company_admin only; sets `status='void'`, audit `punch.void`.
- `getPunchWalkContext(projectId)` — project members (for assignee dropdown) via `project_members`+`profiles`.

All use `attachSupabaseAuth`, zod input validation, `httpError(...)` for policy/status violations.

### 4. Query factory — `src/lib/qaqc-query.ts` (extend)

- `punchListQueryOptions(filters)`
- `punchDetailQueryOptions(id)`
- `punchWalkContextQueryOptions(projectId)`
- `punchBoardKpiQueryOptions(projectId)` — derives `openA`, `openB`, `openC`, `readyForReview` counts from list.

### 5. UI components — `src/components/qaqc/`

- `punch-category-badge.tsx` — semantic tint per A/B/C with tooltip explaining the gate meaning.
- `punch-status-badge.tsx` — badge for open / ready_for_review / closed / void.
- `punch-board-column.tsx` — column of cards (Category header + count + list of `PunchCard`s).
- `punch-card.tsx` — compact card: number, area, description snippet, assignee avatar/email, due-date pill, status badge, click → detail.
- `punch-photo-strip.tsx` — thumbnails from signed URLs, click to open full-size.
- `punch-signoff-dialog.tsx` — typed-name confirmation dialog with warning "Signoff is irreversible".

### 6. Routes — `src/routes/_authenticated/`

**`qaqc.punch.index.tsx`** — dual-view page.
- Header KPI chips: **Open A items** (destructive tint when > 0, tooltip "Blocks COD / energization"), Open B, Open C, Ready for review.
- View toggle: **Board** (default) | **List**, persisted via search param `view=board|list`.
- Filters: project, discipline, area, status, search (search params, mirrors inspection list pattern).
- Board view: three columns A / B / C, each column shows count + stacked `PunchCard`s. Card click → detail. "New punch walk" button top-right → `/qaqc/punch/walk?projectId=...`.
- List view: table (Number, Walk date, Area, Discipline, Category, Description, Assignee, Due, Status), CSV export via `objectsToCsv`.
- Skeleton, empty state (`No punch items yet — start a punch walk` + CTA), error state with retry.

**`qaqc.punch.walk.tsx`** — mobile-first rapid capture.
- Step 1: pick project → area → discipline (persisted in local state, not reset between items).
- Step 2: rapid-add form (react-hook-form + zod): description, category (A/B/C radio with tooltip), due date, assignee (from `getPunchWalkContext`), camera capture.
  - Camera: `<input type="file" accept="image/*" capture="environment">` → uploads to `photos` bucket at `{companyId}/{projectId}/field/{walkDate}/` → inserts into `site_photos` → collects returned id into `photoIds[]`.
- Submit → toast success → form resets to blank item (area/discipline preserved) → auto-focus description for **add another** loop.
- Sticky bottom bar: "Add another" (primary) + "Done — back to board" (link back to `/qaqc/punch`).
- Running counter chip: "3 items added this walk".

**`qaqc.punch.$id.tsx`** — detail.
- Header: number, category badge (with tooltip), status badge, area · discipline · walk date.
- Body cards: Description (editable if role can write & status not closed), Assignee/Due date (editable), Photo strip, Status timeline (Raised → Ready → Closed with names & timestamps derived from row + audit log optional).
- Actions (role-aware, server-enforced too):
  - `open` + assignee/foreman → **Mark ready for review** button.
  - `ready_for_review` + construction_admin/company_admin → **Sign off** button → opens `PunchSignoffDialog` (typed full name required, checkbox "I confirm this punch item is closed"). On confirm calls `signoffPunchItem`. Irreversible.
  - construction_admin/company_admin can **Void** with reason (small text field in a confirm dialog) at any non-closed state.
- Optimistic status updates via `useMutation` with `onMutate` writing to detail cache; invalidate list + board KPI queries on success.

### 7. Nav map — `src/lib/nav-map.ts`

Add:
```ts
{ moduleKey: "field_qaqc", label: "Punch list", url: "/qaqc/punch", icon: ClipboardCheck },
```

### 8. Tests

- `tests/unit/qaqc-punch.test.ts`
  - `nextPunchNumber(1)` → `PN-0001`, `(42)` → `PN-0042`.
  - `canSignoff(['foreman'])` → false; `canSignoff(['construction_admin'])` → true; `canSignoff(['company_admin'])` → true; `canSignoff(['field_technician'])` → false.
  - `punchInput` zod: rejects empty description, rejects invalid category.
  - `punchSignoffInput` zod: rejects `signoffName` shorter than 2 chars.
- `tests/rls/qaqc-punch.rls.test.ts` — stub verifying cross-tenant SELECT returns 0 rows and non-authorized role INSERT rejected.

### Verification checklist (spec)

- Full `0042_qaqc.sql` applies twice cleanly (guarded enums + `if not exists`).
- Cross-tenant SELECT → 0 rows.
- Punch-walk rapid-add loop with camera → 3 items with photos, 1 category A.
- Signoff flow: only construction_admin/company_admin succeed; typed name & timestamp recorded; status closes.
- Board "Open A items" chip matches `count(category='A' AND status<>'closed' AND status<>'void')` — feeds Batch 10's COD gate.
- Category tooltip renders A/B/C semantics.
- Every mutation writes `writeAuditLog`.
- Skeleton, empty, error states on both routes.

### Files touched (summary)

- Modified: `supabase/migrations/0042_qaqc.sql`, `src/lib/qaqc.rules.ts`, `src/lib/qaqc.functions.ts`, `src/lib/qaqc-query.ts`, `src/lib/nav-map.ts`.
- New: `src/components/qaqc/{punch-category-badge,punch-status-badge,punch-board-column,punch-card,punch-photo-strip,punch-signoff-dialog}.tsx`; `src/routes/_authenticated/qaqc.punch.index.tsx`, `qaqc.punch.walk.tsx`, `qaqc.punch.$id.tsx`; `tests/unit/qaqc-punch.test.ts`, `tests/rls/qaqc-punch.rls.test.ts`.
