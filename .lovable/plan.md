## P-103 — SCADA telemetry table + guarded ingestion hook

Two deliverables: the time-series store, and the first public machine-to-machine POST endpoint. Read-only in the app, service-role writes only through the guarded hook.

### 1. Migration `supabase/migrations/0048_scada_telemetry.sql`

- `public.scada_telemetry` with FKs to `companies`, `projects`, `scada_assets (on delete cascade)`.
- Columns: `ts timestamptz`, `metric text`, `value numeric`, `quality text default 'good'`, `created_at`.
- PK `(scada_asset_id, metric, ts)` — dedupe key for idempotent replays.
- Indexes: `(project_id, ts desc)`, `(scada_asset_id, ts desc)`.
- Grants: `SELECT` only to `authenticated`; `ALL` to `service_role` (hook client). No INSERT/UPDATE/DELETE grants to `authenticated` — writes flow exclusively through the guarded hook.
- RLS enabled + policy `telemetry_select FOR SELECT TO authenticated USING (is_company_member(company_id))`.
- Table comment documents the retention plan (raw 1-min kept 13 months, downsample job lands in B14/P-135) and the RANGE-partitioning upgrade path (`scada_telemetry_YYYYMM` + default partition, keep `(scada_asset_id, metric, ts)` as partition-local PK).

### 2. Endpoint `src/routes/api/public/hooks/scada/telemetry.ts` — POST only

Wired under `/api/public/*` so the published-site auth bypass applies; endpoint enforces its own auth.

**Minimal API-key check (marked for upgrade):**
```
// TODO(B13/P-121): replace with guardPublicHook(request, {
//   requireSignature: true,
//   scopes: ['scada:telemetry:write'],
// }) — adds cf-connecting-ip allowlist, timestamped HMAC (300s
// replay window), and consume_rate_limit with warn/block modes.
```
- Read `Authorization: Bearer <key>`; strip prefix; require non-empty.
- SHA-256 hash the raw key (`node:crypto`), look up `api_keys` via `verify_api_key(p_raw_key)` — reuses the existing security-definer RPC that also updates `last_used_at`, validates `revoked_at is null`, and honors `expires_at`.
- Require `'scada:telemetry:write'` in the returned `scopes[]`. Any failure → `401 { error: 'unauthorized' }` (JSON, always — even before the full guard exists).

**Request validation (zod):**
- `{ readings: [{ asset_key: string, ts: string (ISO 8601), metric: enum(...), value: number.finite(), quality?: 'good'|'suspect'|'bad' }] }`
- `readings.length` ≤ 1000 (otherwise `413 { error: 'too_many_readings' }`).
- Metric enum matches the migration comment set: `ac_power_kw | dc_power_kw | energy_kwh | irradiance_wm2 | ambient_temp_c | module_temp_c | wind_speed_ms | soc_pct`.

**Ingestion pipeline (service-role client only inside this handler):**
1. `import('@/integrations/supabase/client.server')` **inside the handler** (never at module scope of a route file).
2. Distinct-scan `asset_key` set; resolve to `scada_assets.id` **filtered by the API key's `company_id`** in a single query. Any `asset_key` that isn't in that company → row goes to the rejected bucket with reason `unknown_asset_or_cross_company`; row is never written.
3. Map surviving readings to insert payloads carrying `company_id`, `project_id` (from `scada_assets`), `scada_asset_id`, `ts`, `metric`, `value`, `quality`.
4. Batch insert in chunks of 500 with `.upsert(rows, { onConflict: 'scada_asset_id,metric,ts', ignoreDuplicates: true })` — idempotent replays return `accepted` count based on rows returned; duplicates count toward `accepted` (already-known reading, not a rejection).
5. Per-row zod / parse / db failures accumulate into `errors[]`, capped at 20 entries.

**Response shape:** `{ accepted: number, rejected: number, errors: Array<{ index, asset_key, reason }> }` (status `200` on any partial success, `400` when *all* rows fail validation).

**Audit + downstream hook:**
- One `writeAuditLog('scada.telemetry_ingest','scada_telemetry',null,{accepted,rejected,company_id})` per request. Since `writeAuditLog` reads `auth.uid()` and this hook has no session, call `insert into public.audit_logs` directly with `actor_id=null` and `company_id` from the API key (server-role insert bypasses the profiles-lookup requirement in the SQL helper). Add a note comment referencing this deviation.
- After successful batch: `try { const mod = await import('@/lib/alarms.functions'); if (typeof mod.evaluateAlarmRules === 'function') void mod.evaluateAlarmRules({ data: { company_id, asset_ids } }); } catch { /* not landed yet */ }` with `// TODO(P-105)` marker.

**CORS:** none — machine-to-machine only. No `OPTIONS` handler.

### 3. Seed one API key with the write scope

Once the migration is approved, mint a raw key server-side via `supabase--insert`:
- Generate 32 random bytes, hex-encode → raw key.
- SHA-256 hex → `key_hash`.
- Insert into `api_keys` with `scopes = ARRAY['scada:telemetry:write']`, `name = 'P-103 test key'`, `company_id` = first company.
- **Return the raw key ONCE in chat** so you can curl with it. It will never be recoverable afterward.

### 4. Unit test `tests/unit/scada-telemetry-hook.test.ts`

Pure-logic tests only (no live DB): zod schema accepts valid batches, rejects >1000, rejects unknown metrics, rejects non-finite numbers. Cross-company/unknown-asset filtering is exercised as a pure function extracted from the handler (`filterReadingsByAsset({ readings, assetMap })`).

### 5. Manual verification checklist (to run after approval + seed)

- `curl -H "Authorization: Bearer <key>" -H "content-type: application/json" -d '{"readings":[…10]}' https://<preview>/api/public/hooks/scada/telemetry` → `{accepted:10, rejected:0}`; rows visible via `psql`.
- Replay identical batch → `{accepted:10, rejected:0}`, still one row per `(asset,metric,ts)`.
- Missing / revoked / wrong-scope key → `401`.
- Reading with an asset belonging to another company → row in `rejected`, `scada_telemetry` unchanged.
- `audit_logs` row `action='scada.telemetry_ingest'` per request; `TODO(B13/P-121)` marker present in the handler.

### Files touched

- `supabase/migrations/0048_scada_telemetry.sql` (new, via migration tool)
- `src/routes/api/public/hooks/scada/telemetry.ts` (new)
- `src/lib/telemetry-ingest.ts` (new — pure zod schema + `filterReadingsByAsset` so the route stays thin and testable)
- `tests/unit/scada-telemetry-hook.test.ts` (new)
- Seed via `supabase--insert` (no file) — raw key surfaced in chat once
