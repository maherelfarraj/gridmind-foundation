## P-102 — SCADA connector configuration UI

### Server layer (`src/lib/scada.functions.ts`)
All fns use `createServerFn` + `requireSupabaseAuth` + zod. Each write re-checks `has_company_role('om_admin' | 'scada_admin')` via `context.supabase.rpc('has_company_role', ...)` and calls `write_audit_log` on success.

- `listConnectors({ companyId })` — connectors joined with project name; KPI aggregates (active count, assets mapped count, max `last_seen_at`).
- `createConnector({ project_id, name, connector_type, config, asset_kind })` — insert `scada_connectors` row (enabled=false, status='disabled'), audit `scada_connector.create`.
- `updateConnector({ id, name?, config? })` — audit `scada_connector.update`.
- `toggleConnector({ id, enabled })` — flip `enabled`, set `status = enabled ? 'active' : 'disabled'`, audit `scada_connector.toggle`.
- `upsertScadaAssets({ connector_id, assets: [{ asset_key, asset_type, name, equipment: { tag, equipment_type, manufacturer?, model? } }] })` — for each row: upsert equipment_registry by `(project_id, tag)` then upsert scada_assets by `(project_id, asset_key)` linking `equipment_id`. Audit `scada_asset.upsert` (one row per batch with count metadata).
- `testConnector({ id })` — stub: verify membership + role, return `{ ok: null, message: "test pending — wired in B13" }`. No side effects.

**Credentials rule (zod-enforced):** `config.credentials_ref` must match `/^[A-Z][A-Z0-9_]{2,63}$/` (env-var name shape). A regex reject on any value containing lowercase, whitespace, or common token prefixes (`sk_`, `pk_`, `Bearer `, `eyJ`) drops the submission with a clear error. `credentials_ref` is the ONLY credential-adjacent field the schema accepts; any other field name is stripped by the zod `.strict()` object before insert.

### Routes
- `src/routes/_authenticated/om.scada.connectors.tsx` — list page. Header KPI strip (active connectors, mapped assets, last telemetry seen via `formatDistanceToNow`). shadcn `Table` with type badge, project cell, `Switch` (optimistic mutation), status badge, relative last_seen. Skeleton, empty-state card, error card with retry. "Add connector" opens wizard dialog.
- Wizard component (`src/components/om/scada-connector-wizard.tsx`) — react-hook-form + zod, 3 steps:
  1. Stream kind (inverter | meter | weather_station | plant_controller | bess) + project select.
  2. Connector type + dynamic per-type config fields (modbus_tcp: host/port/unit_ids/poll_interval_s; iec61850: host/port/poll_interval_s; sunspec: host/port/unit_ids; mqtt: broker_url/topic; vendor_api: base_url; csv_import: source_label). Single `credentials_ref` text input with helper text "Secrets live in the Lovable Cloud secret store; enter the variable name only." Client-side regex mirror of server rule + inline error.
  3. Asset mapping — dynamic field array of `{ asset_key, asset_type, equipment_tag, equipment_type, manufacturer, model }`. "Test connection" button between steps 2 and 3 calls `testConnector` stub and toasts the info message.
- Save creates connector then upserts assets in sequence; invalidates `["scada", "connectors", companyId]`.

### Sidebar
Add nav item in `src/lib/nav-map.ts` under the existing "Operate" section (or wherever `om_scada` lives): `{ moduleKey: "om_scada", label: "SCADA connectors", url: "/om/scada/connectors", icon: Radio }`. Gate visibility by role: extend `NavItem` with an optional `requiresAnyRole?: AppRole[]` and filter in `app-sidebar.tsx` — item shown only when the user's roles include `om_admin`, `scada_admin`, or `company_admin`. Non-matching roles hit the route → server fns throw 403.

### Verification
- Manual: wizard flow creates 1 connector + 2 mapped assets end-to-end; toggle flips status; audit rows land.
- Unit tests (`tests/unit/scada-connectors.test.ts`): zod schema rejects lowercase / whitespace / `sk_...` / `Bearer ...` / JWT-shaped `credentials_ref`; accepts `SCADA_VENDOR_TOKEN`. KPI reducer picks max `last_seen_at`.

### Out of scope
Real telemetry ingestion (P-103). `testConnector` is a stub.
