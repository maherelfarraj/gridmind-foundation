## P-101 — O&M assets + SCADA foundation migration

Create `supabase/migrations/0047_om_assets_scada.sql` with the exact SQL from the prompt, plus:

- Guarded `do $$ ... $$` blocks around the 5 `create type` statements (idempotent re-runs).
- `set_updated_at()` triggers on all 3 tables.
- Explicit `grant ... to service_role` alongside authenticated grants (per project convention).
- Indexes and unique constraints as specified.

### Tables
- `equipment_registry` — physical asset master, unique `(project_id, tag)`.
- `scada_assets` — mapping layer to external SCADA `asset_key`, unique `(project_id, asset_key)`, FK to `equipment_registry` (on delete set null).
- `scada_connectors` — one connector config per project, unique `(project_id, name)`, `enabled` separate from `status`, credentials referenced by env-var name only in `config` jsonb.

### RLS
- SELECT: `is_company_member(company_id)`.
- Writes (ALL): member + (`om_admin` OR `scada_admin` OR `company_admin`).

### After migration
- Auto-regenerated types will pick up the new tables/enums.
- No UI in this batch.

### Verification queries (post-apply)
- `pg_class.relrowsecurity = true` for all 3.
- Duplicate `(project_id, tag)` rejected.
- Cross-tenant SELECT returns 0.
- Trigger fires on update.

No frontend or server-function changes in this prompt.
