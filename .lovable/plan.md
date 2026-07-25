## P-104 — Live SCADA dashboard

Build the O&M module landing page at `/om/scada` with live plant KPIs, a 24 h power curve, and a fleet status table. Read-only; no mutations; no audit writes.

### New files

- `src/lib/scada-dashboard.functions.ts` — server fns behind `requireSupabaseAuth`:
  - `getScadaDashboard({ projectId?: string })` — returns `{ tiles, powerCurve, plants, lastUpdated, weatherAvailable }`.
  - `getPlantDetail({ projectId })` — same tile set scoped to one plant + `perInverter: [{ name, currentKw, todayKwh, lastSeen }]`.
- `src/lib/scada-dashboard.rules.ts` — pure helpers (unit-tested):
  - `latestPerAsset(rows, metric)` — last value per `scada_asset_id`.
  - `energyDelta(rows)` — sum of `max−min` per asset since local midnight (fallback to `sum(value)` when only deltas are ingested; document choice).
  - `bucketPowerCurve(rows, minutes = 5)` — 5-min bucketed sum of `ac_power_kw` + mean `irradiance_wm2`.
  - `performanceRatio({ actualKwh, irradianceSeries, nameplateKw })` — irradiance-weighted expected; returns `null` when no weather.
  - `plantAvailabilityBadge(pct)` — `green ≥99 | amber 97–98.9 | destructive <97 | null → '—'`.
  - `isStale(lastSeen, minutes = 15)`.
- `src/routes/_authenticated/om.scada.index.tsx` — dashboard route (default `/om/scada`).
- `src/routes/_authenticated/om.scada.plants.$projectId.tsx` — plant drill-down.
- `src/components/om/scada-kpi-tiles.tsx`, `scada-power-curve.tsx`, `scada-fleet-table.tsx`, `scada-inverter-bars.tsx` — presentation only, semantic tokens.
- `tests/unit/scada-dashboard.test.ts` — covers bucketing, energy delta, PR math, availability tier, stale threshold.

### Data & gating

- All queries via `context.supabase` (RLS as user). Tables: `scada_telemetry`, `scada_assets`, `equipment_registry`, `projects`.
- Header project selector: default = all projects where `phase = 'operations'` for the user's company; loaded via a small `listOperationsPlants` server fn.
- Nav item "SCADA dashboard" in `src/lib/nav-map.ts` visible to `om_admin`, `scada_admin`, `company_admin`, `project_admin` (read-only). No new roles.

### Tile compute rules

- **Fleet power now**: sum of latest `ac_power_kw` per asset within last 15 min.
- **Energy today**: sum over assets of (`max(energy_kwh) − min(energy_kwh)`) for rows since local midnight (Intl `Asia/Kolkata` fallback → UTC when profile lacks tz; use browser tz for display, server computes UTC-midnight window and returns both boundaries).
- **Availability 30 d**: `scada_alarms` / `work_orders` don't exist yet — tile returns `null` with tooltip "Populates after alarm rules (P-105) & work orders (P-106)". Render as `—`.
- **PR %**: requires at least one `weather_station` asset for the scope with `irradiance_wm2` in-window; else `{ value: null, reason: 'insufficient_data' }` → "insufficient data" empty tile.
- **Active alarms**: `scada_alarms` absent → count = 0, badge hidden; wire the read behind a `try/catch` on the table-missing error so P-105 turns it on with no code churn.

### Power curve

- Server returns last 24 h aggregated to 5-min buckets, plus `irradiance_wm2` mean per bucket when a weather asset exists.
- Recharts `ComposedChart`: area for power (primary axis, kW), line for irradiance (secondary axis, W/m²). Responsive container, tokenized colors, tooltip with units.

### Fleet table

- Row per project in scope: `name`, capacity MW (`sum(nameplate_capacity_kw)/1000`), current kW, today kWh, availability badge, active alarms, `last_seen_at` (rel via `date-fns`, red highlight if stale).
- Row click → `/om/scada/plants/$projectId`.

### Live behavior

- TanStack Query: `queryKey: ['scada-dashboard', projectId]`, `refetchInterval: 30_000`, `staleTime: 15_000`.
- Header caption "Last updated HH:mm:ss" from `dataUpdatedAt`.
- States: skeleton (tiles + chart + table), empty ("No telemetry yet — configure a connector in SCADA settings" with link to `/om/scada/connectors`), error with retry button (`router.invalidate()` + `refetch()`).

### Drill-down `/om/scada/plants/$projectId`

- Reuses `<KpiTiles>`, `<PowerCurve>`, plus `<InverterBars>`: Recharts bar chart of current `ac_power_kw` per inverter, sorted desc, tokenized colors.

### Out of scope (explicit)

- No migration. No mutations. No new tables. No changes to `scada_telemetry` schema.
- Alarm counts and availability wire up when P-105 / P-106 land.

### Verification

- Unit tests for helpers.
- Manual: push varied telemetry via the P-103 curl; confirm curve renders, tiles compute, stale highlighting works, drill-down loads, non-O&M roles see no nav entry.

next → P-105 (alarm rules engine 🚨) after approval.