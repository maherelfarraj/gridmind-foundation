## P-054 — SLD Gallery + `project_sld_config` Editor

### 1. Migration `0019_sld_config_extend.sql` (idempotent)
Extend `public.project_sld_config` with the missing columns (idempotent `ADD COLUMN IF NOT EXISTS`):
- `bus_config text default 'single'` (values enforced app-side: `single | single_sectionalized | double | ring`)
- `metering_points jsonb default '[]'`
- `protection_scheme text`
- `notes text`

`voltage_levels jsonb default '[]'` already exists — skip. RLS, grants, and `updated_at` trigger unchanged.

**Drawing tagging** — `drawing_register` has no `tags` column. Rather than adding one just for SLD (out of scope), tag SLDs by prefixing `drawing_number` with `SLD-` on creation and filtering `discipline='electrical' AND drawing_number ILIKE 'SLD-%'`. Documented in the "New SLD" dialog.

### 2. Server functions — `src/lib/sld.functions.ts`
All `createServerFn` + zod + `requireSupabaseAuth`:
- `getSldConfig({ projectId })` — returns row or defaults; company member read.
- `saveSldConfig({ projectId, bus_config, voltage_levels[], metering_points[], protection_scheme?, notes? })` — writes row (upsert on `project_id`); role gate `engineering_admin | engineer | project_admin` via `has_role`; writes `audit_logs` action `engineering.sld_config_saved` with changed field diff.
- `listSldDrawings({ projectId })` — selects `drawing_register` where `discipline='electrical' AND drawing_number ILIKE 'SLD-%'`, joins current revision + markup count.
- `createSldDrawing({ projectId, drawing_number, title })` — prefixes `SLD-` if missing, delegates to existing `createDrawing` logic.

Zod: `kv > 0 && kv <= 500`, `voltage_levels.length >= 1`, `bus_config` enum, string caps 200/2000.

### 3. Query hooks — `src/lib/sld-query.ts`
`sldConfigQueryOptions`, `sldDrawingsQueryOptions`, `useSaveSldConfig` (optimistic + invalidate), `useCreateSldDrawing`.

### 4. Route — `src/routes/_authenticated/projects.$projectId.engineering.sld.tsx`
Tabs (shadcn `Tabs`): **Gallery** | **Configuration**.

Add `"sld"` to `SUB_TABS` in the engineering layout file.

### 5. Components — `src/components/engineering/`
- `sld-gallery.tsx` — grid of cards (thumbnail from first revision file signed URL via `<iframe>` for PDF / `<img>` for image, matching P-053 pattern; placeholder icon on error), drawing number, current revision code, status badge, markup count. Click → `/projects/$projectId/engineering/drawings/$drawingId`. Empty state + "New SLD" dialog (number auto-prefixed `SLD-`, title). Non-write roles: hide "New SLD".
- `sld-config-form.tsx` — react-hook-form + zod:
  - bus_config `Select`
  - voltage-level list editor (`useFieldArray`): rows of `{ kv: number, type: 'collection'|'export'|'auxiliary' }` with add/remove
  - metering-points list editor: rows of `{ location: string, purpose: string }`
  - `protection_scheme` textarea, `notes` textarea
  - Save button disabled for read-only roles; sonner toast on success; inline zod errors
- `sld-hierarchy-preview.tsx` — read-only card computing sorted voltage-level chain e.g. `"33 kV collection → 132 kV export"`.

### 6. Verification checklist (post-approval, manual)
- Migration applies; new columns visible.
- Zero voltage levels → inline error; add 33 kV collection + 132 kV export → saves; hierarchy preview shows `"33 kV collection → 132 kV export"`.
- Audit row `engineering.sld_config_saved`.
- "New SLD" → gallery card → opens P-053 detail.
- Non-engineering roles: no write controls; RLS blocks cross-tenant.
- `bunx tsgo --noEmit` clean.

### Technical notes
- No `tags` column added to `drawing_register` — SLD detection uses `SLD-` drawing_number prefix.
- Follows existing `.functions.ts` + `-query.ts` split; helpers stay imported (server-fn-splitting rule).
- Design tokens only; shadcn `Tabs`, `Form`, `Card`, `Badge`, `Select`, `Button`, `Dialog`.
