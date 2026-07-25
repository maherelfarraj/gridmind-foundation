## P-083 — Field core migration

Apply `supabase/migrations/0039_field_core.sql` exactly as specified, then add an RLS stub test.

### Migration (single call, ordered)

1. **Enums** via guarded do-blocks: `dpr_status`, `observation_severity`, `observation_status`, `weather_delay_type`, `offline_queue_status`.
2. **Tables** (all with `company_id`, `id`, `created_at`, `updated_at`, `created_by` where meaningful):
   - `construction_daily_reports` — `unique (company_id, project_id, report_date, shift)`
   - `manpower_logs` — `dpr_id` FK with `on delete cascade`
   - `field_observations` — `dpr_id` FK with `on delete set null`
   - `weather_delays` — references `wbs_items(id)`
   - `site_photos` — `file_path` under `photos` bucket at `{company_id}/{project_id}/field/{report_date}/`
   - `offline_queue` — `unique (company_id, user_id, client_idempotency_key)` for idempotent retries
3. **RLS enabled** on all six; policies:
   - SELECT: `is_company_member(company_id)`
   - Writes: `construction_admin` / `foreman` / `field_technician` / `company_admin` — observations & photos also allow `hse_admin`
   - `offline_queue`: rows scoped to `user_id = auth.uid()` (admins can SELECT all)
4. **GRANTs to authenticated** — SELECT on all six; INSERT/UPDATE/DELETE on DPRs & manpower; INSERT/UPDATE on the rest.
5. **Indexes** exactly as listed in the spec.
6. **Attach `trg_updated_at`** (via `public.set_updated_at()`) to all six tables.

DPR approval role restriction (`construction_admin`/`company_admin` only) will be enforced later in the RPC layer (P-084/P-085), not at the RLS level, as noted in the spec.

### Verification (after migration)

- Show columns + RLS status for the six tables.
- Attempt to insert a duplicate DPR (same project/date/shift) → expect unique violation.
- Cascade check: deleting a DPR removes its `manpower_logs`.

### Test stub

Add `tests/rls/field-core.rls.test.ts` — placeholder describe/it blocks per table (select/write matrix) matching the pattern used in `tests/rls/rfq-core.rls.test.ts`.

### Out of scope this batch

No UI, no server functions, no RPCs — pure data backbone. Field UI, offline sync engine, and DPR approval RPC land in P-084/P-085.