# P-086 — DPR Capture (Mobile-First)

Ship the field-team's primary data-entry surface. All schema exists from P-083; storage policies for `photos` already cover the `{company}/…` prefix. **No migration needed.**

## Scope

Three routes under `_authenticated/`:
- `/field/dpr` — filterable list (project, date range, status, search)
- `/field/dpr/new` — auto-creates a `draft` DPR then redirects to detail
- `/field/dpr/$dprId` — 4-step wizard, submit, approve

## Files

**Rules / server**
- `src/lib/dpr.rules.ts` — Zod schemas (dpr, manpower row, weather delay, quantity row, observation quick-add), `sumManpower(rows)`, `canEditDpr(status, roles, isCreator)`, `canApprove(roles)`, `deriveDisciplineFromWbs(item)`, `photoObjectPath(company, project, date, filename)`.
- `src/lib/dpr.functions.ts` — `createServerFn` + `requireSupabaseAuth`:
  - `listDprs({ projectId?, from?, to?, status?, search? })`
  - `getDpr({ id })` → header + manpower + weather + photos + observations
  - `upsertDprHeader({ id?, projectId, reportDate, shift, weather*, workSummary, constraints })` (idempotent on unique key → surfaces "duplicate date+shift" error via PG code 23505)
  - `addManpowerRow`, `updateManpowerRow`, `deleteManpowerRow` (each recomputes totals on the DPR)
  - `addWeatherDelay`, `deleteWeatherDelay`
  - `addQuantityRow`, `deleteQuantityRow` (mutate `quantities` jsonb, derive discipline from WBS)
  - `attachPhoto({ dprId?, observationId?, filePath, caption?, area? })`
  - `createObservation({ dprId?, severity, description, area?, dueDate? })`
  - `submitDpr({ id, acknowledgeNoPhotos? })` — blocks if a required section is empty; requires `acknowledgeNoPhotos=true` when zero photos
  - `approveDpr({ id })` — role-gated
  - Every mutation calls `write_audit_log` with the required action names (`dpr.create/update/submit/approve`, `observation.create`, `weather_delay.create`, `photo.attach`).
- `src/lib/dpr-query.ts` — TanStack Query options (`dprListOptions`, `dprDetailOptions`, `wbsPickerOptions(projectId)`).
- `src/lib/wbs-picker.functions.ts` — lightweight `listWbsForPicker({ projectId, q? })` returning `{ id, code, name, discipline, area, uom }` (reuses columns added in P-085).

**UI (mobile-first: 360px baseline, sticky bottom bar, 44px touch targets, semantic tokens)**
- `src/routes/_authenticated/field.dpr.index.tsx` — list with filters, skeleton, empty ("No daily reports yet — tap New Report"), error+retry, "no photos" chip for submitted DPRs missing photos, floating "New Report" CTA.
- `src/routes/_authenticated/field.dpr.new.tsx` — project + date + shift picker; on submit calls `upsertDprHeader` then navigates to `/field/dpr/$dprId`.
- `src/routes/_authenticated/field.dpr.$dprId.tsx` — stepper shell (steps in URL search `?step=1..4`), sticky bottom action bar (`Prev / Save draft / Next` on 1–3; `Submit` on 4 with photo-guard modal).
- `src/components/dpr/step-manpower.tsx` — repeatable rows (trade select, contractor, headcount stepper ±, hours); denormalized totals shown live.
- `src/components/dpr/step-weather.tsx` — summary + high/low °C + delay list (add sheet: type, times, lost hours, WBS picker, notes).
- `src/components/dpr/step-quantities.tsx` — add-row bottom sheet with searchable WBS picker; discipline & UoM auto-fill; area editable.
- `src/components/dpr/step-photos.tsx` — capture (`<input type=file capture="environment" accept="image/*" multiple>`), gallery grid, per-photo "Link to observation" quick-add sheet, per-DPR observation list.
- `src/components/dpr/photo-guard-dialog.tsx` — amber SHOULD banner + explicit "Submit without photos" checkbox.

**Nav / tests**
- Add "Daily reports" entry to `src/lib/nav-map.ts` (Field section, `ClipboardList` icon).
- `tests/unit/dpr-rules.test.ts` — `sumManpower`, `canEditDpr`, `canApprove`, `photoObjectPath` (company UUID first), submit-guard branches.

## Behavior details

- **Autosave draft**: each step mutation writes immediately (no local draft state); optimistic totals update via `queryClient.setQueryData`.
- **Photo upload**: uses browser Supabase client → `photos` bucket at `{companyId}/{projectId}/field/{reportDate}/{uuid}-{filename}`, then calls `attachPhoto`. Company-first path is required by existing `storage_company_id` policy.
- **Submit guard**: server checks manpower rows > 0; if `site_photos` count = 0, requires `acknowledgeNoPhotos=true` else throws `photos_required_ack`. UI shows the amber banner + checkbox before enabling Submit.
- **Approve**: visible only when `has_company_role('construction_admin' | 'company_admin')` AND status = `submitted`.
- **Read-only after submit**: `canEditDpr` returns false; UI disables inputs & hides mutation buttons; server double-guards.
- **Duplicate date+shift**: catch PG `23505` from `upsertDprHeader`, throw friendly `"A DPR already exists for this project on {date} ({shift} shift)"`; form surfaces inline on the `reportDate` field.

## Verify

- `bunx tsgo --noEmit`
- `bunx vitest run tests/unit/dpr-rules.test.ts`
- Manual smoke via preview at 360px width: create today's DPR → 3 manpower rows → weather delay → 2 quantity rows → 0-photo submit shows guard → check the new row appears on `/field/discipline-board` after adding photos & approving.

## Out of scope (later tickets)

- Offline queue integration (P-087).
- Server-side photo thumbnails / EXIF GPS extraction.
- Bulk photo captioning.
