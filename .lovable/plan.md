P-017 migration 0009 was already applied in the prior turn. The SQL you just pasted is the canonical source. I'll reconcile the live database against it and only apply a corrective migration if something drifts.

## Steps

1. Run verification queries against the live DB:
   - Columns of `api_keys`, `webhook_endpoints`, `webhook_deliveries` (names, types, defaults, nullability).
   - Indexes on all three tables (confirm `api_keys_company_idx`, `webhook_endpoints_company_active_idx`, `webhook_deliveries_retry_idx` partial-where, `webhook_deliveries_endpoint_idx`).
   - RLS enabled flag + policy list per table (names: `api_keys_select/write`, `webhook_endpoints_select/write`, `webhook_deliveries_select`).
   - Table GRANTs to `anon` (should be none) and `authenticated` (SIUD on api_keys/webhook_endpoints, SELECT on webhook_deliveries).
   - `verify_api_key(text)` definition, `security definer`, `search_path=public`, EXECUTE grants (authenticated + service_role only; not anon).
   - `delivery_status` — note the pasted SQL uses a `text` + CHECK constraint, not an enum. Confirm which is live.

2. Diff live state vs the pasted SQL. Expected differences vs the earlier applied version:
   - `status` column: earlier apply used a `delivery_status` enum; pasted SQL uses `text` + CHECK. Flag this.
   - Anything else that drifts.

3. Report the diff to you. Do nothing else until you approve one of:
   - Accept live state (no migration), or
   - Apply a corrective `0009a` migration to make live match the pasted SQL exactly (e.g., convert enum column back to text+check, or rename/add indexes).

No file edits, no new migration written in this step — verification only, then wait for your call.
