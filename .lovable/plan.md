# Restore and verify SCADA telemetry flow post warn-to-block flip

## Current state
- 7-day cleanliness query returned zero denied/signature/rate-limit events; the warn-to-block flip is active and live endpoints now return 401 for unauthenticated traffic.
- `scada_telemetry` is empty: 0 rows in the last 24 hours, 0 rows total.
- Root cause: the East Amman SCADA Gateway API key (`api_keys` row) has `hmac_secret = NULL`, and `/api/public/hooks/scada-telemetry` requires HMAC signatures. Any external push would fail with `secret_not_configured` before writing rows.
- `scada_tags` is empty (0 tags), so even if data arrived there are no tag definitions/mappings for the 10 seeded assets.
- `scada_connectors` has one active `vendor_api` connector pointing at the public hook URL, but `last_seen_at` is NULL.
- No ingestion runs exist in `ingestion_runs`.

## Plan

### 1. Harden the gateway API key
- Generate an HMAC secret for the existing `api_keys` row for the East Amman SCADA Gateway.
- Store it in the `hmac_secret` column. This unblocks signed telemetry pushes.
- Record the action in `audit_logs`.

### 2. Seed the tag dictionary
- Create a migration that inserts one active `scada_tags` row per asset/metric pair needed for the demo dashboard (e.g. `ac_power_kw`, `dc_power_kw`, `energy_kwh`, `irradiance_wm2`, `ambient_temp_c`, `module_temp_c`, `wind_speed_ms`, `soc_pct` for the PV inverters, BESS, weather station, etc.).
- Tag definitions include scale, unit, sample interval, and reasonable min/max/alarm/warn limits.

### 3. Inject synthetic telemetry
- Add a small, idempotent server function (or script) that generates 24 hours of realistic telemetry for the showcase assets using a diurnal power curve and weather pattern, then writes it to `scada_telemetry` via the service role client.
- Re-run the 24-hour count query to confirm rows exist.
- Confirm `scada_connectors.last_seen_at` updates after the first successful batch (either by direct update or by the public hook path in the next step).

### 4. Verify the public hook end-to-end
- Use the gateway API key + HMAC secret to send a signed `POST /api/public/hooks/scada-telemetry` request from a local test script.
- Confirm:
  - Valid signed request → 200 with accepted rows.
  - Invalid signature → 401/403.
  - Missing Bearer → 401.
- Confirm the cleanliness query still stays clean (no new `ip_denied`/`signature_failed`/`rate_limited` events from legitimate traffic).

### 5. UI/connector sanity check
- Open `/om/scada/connectors` and `/om/scada` to confirm the connector shows data, the dashboard renders KPIs, and the last-telemetry timestamp updates.
- Verify the API key is visible in the API-key management UI with the correct scope and that the connector config still references the public hook URL.

### 6. Record confirmation
- Insert a second `audit_logs` row documenting that live telemetry is restored and the public hook is verified in block mode.

## Technical notes
- All writes are scoped to the GSI company (`1ab0730f-d6fa-4678-b1b7-7f752c80eceb`) and project `d887fd69-4542-4ae4-a9a1-e0253e7258ff`.
- The HMAC secret will be stored in the existing `hmac_secret` column of `api_keys`. If that column is considered sensitive, flag it for future migration to a hashed/encrypted storage model.
- Synthetic telemetry will use the `ts` column on `scada_telemetry` (the previous `received_at` column does not exist).
- The public hook uses `cf-connecting-ip`; local test scripts will need to include the allowed IP in the API key allowlist or set the header to a permitted IP.

## Verification criteria
- `select count(*) from scada_telemetry where ts > now() - interval '24 hours'` returns > 0 rows.
- `select max(ts) from scada_telemetry` returns a recent timestamp.
- `/api/public/hooks/scada-telemetry` returns 200 for a valid signed request and 401/403 for invalid ones.
- SCADA dashboard `/om/scada` renders KPIs and a 24-hour power curve.
- No new `public_hook.ip_denied`, `public_hook.signature_failed`, or `public_hook.rate_limited` audit events appear in the 7-day window from legitimate gateway traffic.