
## P-040 — Phase Gate Engine

### 1. Migration `0014_gate_approvals.sql`

Apply the exact SQL you supplied (`approval_instances`, `approvals`, FK `gates_approval_fk`, RLS policies, updated_at triggers, grants). Also normalize existing seed checklists so the engine has one shape to work against:

```sql
-- Backfill legacy checklist items {name, done} → {key, label, required, done}
update public.project_phase_gates
   set checklist = (
     select jsonb_agg(
       case
         when item ? 'key' then item
         else jsonb_build_object(
           'key', lower(regexp_replace(coalesce(item->>'name', item->>'label',''), '\W+', '_', 'g')),
           'label', coalesce(item->>'label', item->>'name',''),
           'required', coalesce((item->>'required')::boolean, true),
           'done', coalesce((item->>'done')::boolean, false)
         )
       end
     )
     from jsonb_array_elements(checklist) item
   )
 where jsonb_typeof(checklist) = 'array'
   and exists (select 1 from jsonb_array_elements(checklist) i where not (i ? 'key'));
```

Verify after apply: `\d approval_instances`, `\d approvals`, FK on `project_phase_gates.approval_instance_id`, policies present, no rows lost, sample gate checklist now `{key,label,required,done}`.

### 2. Server functions — `src/lib/gates.functions.ts`

All use `attachSupabaseAuth` + `requireSupabaseAuth`, zod input, and write audit rows via existing RPC `write_audit_log`.

- `getGateHistory({ project_id })` → returns `audit_logs` where `entity='project_phase_gates'` and `metadata->>'project_id' = project_id`, joined with `profiles` for actor name/email, ordered `created_at desc`, limit 200. Company membership enforced by RLS.
- `toggleGateChecklistItem({ gate_id, key, done })` → load gate under RLS; role guard (`company_admin`|`project_admin`) via `has_company_role`; refuse when gate status ∉ `open|in_review`; mutate checklist item — stamp `done_by=auth.uid()`, `done_at=now()` when `done=true`, clear both when `false`; update row; write `audit_logs` `gate.checklist_toggled` with `{project_id, phase, key, done}`. Returns updated checklist.
- `requestGateTransition({ gate_id })` →
  1. Load gate; require status `open` and every `required` item `done` (server re-verifies).
  2. Role guard: `company_admin`|`project_admin`.
  3. Insert `approval_instances` row (`entity='project_phase_gate'`, `entity_id=gate_id`, `requested_by=auth.uid()`, `metadata={project_id, phase}`).
  4. Insert one `approvals` row (status `pending`) per `user_roles.role='company_admin'` in the company (fallback pool until P-111).
  5. Update gate → `status='in_review'`, `approval_instance_id=<new>`.
  6. `write_audit_log('gate.transition_requested', 'project_phase_gates', gate_id, {project_id, phase, approval_instance_id})`.
- `decideGateTransition({ approval_id, decision:'approve'|'reject', comment? })` →
  1. Load approval + instance + gate; assert `approver_id = auth.uid()` and approval status `pending`.
  2. Update the approval row (status, comment, `decided_at`).
  3. On **approve** (single-approver model until P-111): mark instance `approved`, gate → `approved` with `approved_by`/`approved_at`; advance `projects.phase` to next in order `development → ntp → cod → handover`; if current gate was `handover`, also set `projects.status='completed'`; find next gate by `sort_order+1` and set `status='open'`. Audit `gate.transition_approved`.
  4. On **reject**: mark instance `rejected`, gate back to `open`, clear `approval_instance_id`. Audit `gate.transition_rejected` with `{comment}`.

  The DB trigger `trg_gate_audit` already logs raw status changes; our explicit rows add the semantic action + comment.

### 3. Query options

`src/lib/gates-query.ts` — `gateHistoryQueryOptions(projectId)` (staleTime 15s). Reuse `projectDetailQueryOptions` for gate/checklist state; invalidate it plus history on every mutation.

### 4. UI — `src/routes/_authenticated/projects.$projectId.gates.tsx`

Rewrite the placeholder. Layout: two-column on `lg` (`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]`).

**Left — gate cards** (map `project.gates` sorted by `sort_order`):
- Header: name, phase badge, status pill (reuse existing style map + add `rejected`/`completed` styles as needed, semantic tokens only).
- Checklist: shadcn `Checkbox` per item; disabled when gate status `locked`/`approved` or user lacks `company_admin`/`project_admin` (hint tooltip); shows `done_by` name + `done_at` (date-fns `formatDistanceToNow`) when done. Optimistic toggle via `useMutation` + `queryClient.setQueryData` on `project-detail`; rollback + `toast.error` on failure.
- Footer actions:
  - **Request transition** (`Button`) — enabled only when `status==='open'` and every `required` item done and role gate passes. Calls `requestGateTransition`; success toast.
  - When `status==='in_review'` and the current user has a pending `approvals` row on the instance → show **Approve** / **Reject** buttons; Reject opens a `Dialog` with a `Textarea` comment (required). Calls `decideGateTransition`.
- Skeleton via `<Skeleton />`, empty state card ("No gates configured"), error `Alert` with retry (`router.invalidate` + reset).

**Right — Gate history panel**:
- Card titled "Gate history"; `useSuspenseQuery(gateHistoryQueryOptions)`; list newest-first with icon per action (`CheckCircle2`, `XCircle`, `Clock`, `ListChecks`), actor name, relative time (`formatDistanceToNow`), action label, and diff summary from `metadata` (e.g. `to: ntp`, checklist key, comment excerpt).
- Empty state: "No gate activity yet".

Also augment the loader to prime `gateHistoryQueryOptions` alongside project detail.

### 5. Route loader

Update `projects.$projectId.gates.tsx` route to `loader: ({ context, params }) => Promise.all([context.queryClient.ensureQueryData(projectDetailQueryOptions(params.projectId)), context.queryClient.ensureQueryData(gateHistoryQueryOptions(params.projectId))])`, with `errorComponent` + `notFoundComponent` reusing existing `DetailNotFound`.

### 6. Verification (Playwright against Prairie Winds)

1. Sign in as company_admin; open project → Gates.
2. Toggle all 3 Development items; screenshot; assert audit rows `gate.checklist_toggled` (3) via `psql`.
3. Assert "Request transition" disabled before, enabled after.
4. Click Request → gate `in_review`, one `approval_instances` pending, one `approvals` pending; stepper clock icon.
5. Approve → gate `approved`, NTP `open`, `projects.phase='ntp'`, audit rows for approved + phase change.
6. On NTP: toggle items, request, reject with comment "hold" → gate back to `open`, comment persisted, audit `gate.transition_rejected`.
7. History panel shows every entry newest-first.

### Notes
- Approval-instance FK column `approval_instance_id` already exists on `project_phase_gates`; the migration only adds the FK constraint.
- No changes to types file needed until migration approval regenerates it; server functions cast rows narrowly.
- Audit-log append-only invariant already enforced by P-012 grants; we only INSERT.
- Only same-turn writes are the migration + new/edited files listed above. No changes outside gates domain.
