## P-039 — Archetype config forms

Build the Config tab so users can view/edit the archetype-specific engineering, financial, and cybersecurity configuration rows for a project. Read-only for non-privileged members; writable for company/project/engineering admins (financial also finance_admin).

### 1. Shared schema registry
New file `src/lib/schemas/archetype-configs.ts`:
- One zod object per config table, mirroring migration `20260724094907_*.sql` columns (numerics via `z.coerce.number()`, enums via `z.enum([...])`, JSON fields as `z.array(z.record(...))` — `voltage_levels` and `zones_conduits` = array of `{ key, value }` pairs).
- Export `ARCHETYPE_CONFIG_KEYS = ['pv','bess','substation','sld','scada','yield','pvsyst','financial','cybersecurity']` and `configSchemas` map + `ArchetypeConfigKey` type + `CONFIG_LABELS` map (`"PV"`, `"BESS"`, `"SLD"`, `"SCADA"`, `"Yield"`, `"PVsyst"`, `"Financial"`, `"Cybersecurity"`, `"Substation"`).
- Export `ARCHETYPE_CONFIG_MAP: Record<ProjectArchetype, ArchetypeConfigKey[]>` matching the spec (utility_pv → pv/sld/scada/yield/pvsyst/financial/cybersecurity, etc.).
- Export `CONFIG_TABLE_MAP: Record<ArchetypeConfigKey, string>` → `project_pv_config` etc.

### 2. Server functions (append to `src/lib/projects.functions.ts`)
- `getArchetypeConfigs({ project_id })`: `attachSupabaseAuth` + `requireSupabaseAuth`. Verify member via `is_company_member` (using project's `company_id`). Parallel `.maybeSingle()` on all 9 config tables filtered by `project_id`. Return `{ pv: row|null, bess: row|null, ... , canEdit: { <key>: boolean } }` — role flags computed once from `user_roles` (company_admin, project_admin, engineering_admin, finance_admin).
- `saveArchetypeConfig({ config, project_id, values })`:
  - Zod input: `config` = enum of the 9 keys, `project_id` uuid, `values` validated by `configSchemas[config]`.
  - Load project row → `company_id` + archetype. 403 if not member. 403 if config key isn't in that archetype's allowed list (prevent tampering).
  - Role check: caller must hold `company_admin`, `project_admin`, or `engineering_admin`; `financial` also accepts `finance_admin`. Query via `user_roles`.
  - Upsert into `CONFIG_TABLE_MAP[config]` on conflict `(project_id)` DO UPDATE, setting `company_id` from project. JSON key/value arrays serialized as JSON.
  - Call `write_audit_log('project_config.saved', 'project_'+config+'_config', project_id, { fields: Object.keys(values) })`.
  - Return the persisted row.

### 3. Query wiring
New `src/lib/archetype-configs-query.ts` exporting `archetypeConfigsQueryOptions(projectId)` (staleTime 30s, key `['archetype-configs', projectId]`). Consumers use `useSuspenseQuery`; on save, invalidate that key.

### 4. UI — replace `src/routes/_authenticated/projects.$projectId.config.tsx`
- Loader primes both `projectDetailQueryOptions(id)` and `archetypeConfigsQueryOptions(id)`.
- Component reads the project (for archetype) and configs; computes `visibleTabs = ARCHETYPE_CONFIG_MAP[archetype]`.
- Renders a shadcn `<Tabs>` with one `TabsTrigger` per visible key using `CONFIG_LABELS`. Selected tab lives in URL search param `?section=pv` for shareability (default = first tab).
- Each tab renders `<ArchetypeConfigForm configKey={key} projectId={id} initial={configs[key]} canEdit={configs.canEdit[key]} />`.

New components under `src/components/projects/config/`:
- `archetype-config-form.tsx` — generic wrapper: `useForm` with `zodResolver(configSchemas[key])`, default values from `initial` (or DB defaults from schema), `useMutation` calling `saveArchetypeConfig`, sonner toast on success ("Configuration saved"), error toast + inline banner on failure preserving user edits. When `!canEdit`, wraps the form in a `fieldset[disabled]` and shows a muted hint: "You need company_admin, project_admin, or engineering_admin to edit this section" (financial substitutes finance_admin).
- `config-fields/` one small file per key rendering the actual inputs:
  - `pv-fields.tsx`: tracker_type Select (fixed/single_axis/dual_axis), numeric inputs with suffixes (tilt °, GCR, DC/AC, DC MWp, inverter count).
  - `bess-fields.tsx`: chemistry Select (lfp/nmc/flow/other), power MW, energy MWh, duration h, PCS count, container count, cycles/day, augmentation_strategy textarea.
  - `substation-fields.tsx`: voltage_kv, transformer_count, transformer_mva, bay_count, busbar_scheme, grid_code.
  - `sld-fields.tsx`: hv/mv/lv voltage; `voltage_levels` key-value editor (add/remove rows of `{ name, kv }`).
  - `scada-fields.tsx`: protocol Select (modbus_tcp/iec61850/dnp3/opc_ua), polling_interval_sec (s), points_count, historian_retention_days.
  - `yield-fields.tsx`: p50/p90 MWh, GHI, losses %, degradation %, availability %.
  - `pvsyst-fields.tsx`: version, meteo_source, sim_report_url, near_shading %, albedo, bifacial toggle.
  - `financial-fields.tsx`: currency Select (from `currencies` — small static list ok for now), capex_total, contingency %, debt_ratio %, discount_rate %, ppa_price, contract_years.
  - `cybersecurity-fields.tsx`: standard Select (IEC 62443 / NERC CIP / ISO 27019), zones_conduits key-value editor, remote_access_policy textarea, soc_monitoring toggle.
- `key-value-editor.tsx` — reusable JSON array editor (`{ key, value }` rows, add/remove buttons, semantic tokens only).
- `field-shell.tsx` — small helper wrapping label + input + unit suffix + error message.

All UI uses semantic tokens (`bg-card`, `border-border`, `text-muted-foreground`, `text-destructive`) — no hex/rgb/white/black. Copy uses "C&I", "O&M", "Green H₂" spellings.

### 5. Types
Regenerate `src/integrations/supabase/types.ts` isn't needed — tables already exist. Local `ConfigRow` types come from Supabase generated types.

### 6. Verification (Playwright as Demo Admin, Prairie Winds)
1. `/projects/{prairie-id}/config` shows exactly PV, SLD, SCADA, Yield, PVsyst, Financial, Cybersecurity — no BESS or Substation tab.
2. Fill PV: tracker=single_axis, tilt=25, GCR=0.35, DC/AC=1.25, DC=175, inverters=42 → Save → toast → reload → values persist.
3. `select count(*) from project_pv_config where project_id = …` returns 1 after two saves (upsert).
4. `select action, metadata from audit_logs where entity='project_pv_config'` shows `project_config.saved` with `fields` array.
5. Client rejects GCR=9; server rejects a hand-crafted payload with GCR=9 (invoke-server-function).
6. Sign in as a finance_admin-only user → Financial editable, other tabs read-only with hint.
7. `rg -n "#[0-9a-fA-F]{6}|rgb\(|text-white|bg-black" src/components/projects/config src/lib/schemas/archetype-configs.ts` returns no hits.

### Non-goals
- No PVsyst file upload pipeline (just URL text field).
- No P50/P90 recompute — pure data capture (feeds Batch 05–06).
- No new migrations; RLS + role gating already exist from migration 0013.
- No changes to gates, overview, or department tabs.
