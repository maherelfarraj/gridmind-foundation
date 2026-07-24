## P-037 — Project cockpit (approved with adjustments)

Route file: `src/routes/_authenticated/projects.index.tsx` (repo convention). Server fns: `src/lib/projects.functions.ts` (repo convention — no `src/lib/server/` dir exists).

### Label fix (contractual: "COD" all-caps)

- `src/lib/schemas/project-wizard.ts` → `PHASE_LABELS.cod: "COD"`
- `src/lib/projects.functions.ts` → `PHASE_LABELS_SHORT.cod: "COD"` (this map seeds `project_phase_gates.name` on create, so all future projects render COD everywhere; existing Prairie Winds gate row is not backfilled — flagged in report).

### New server fns (`src/lib/projects.functions.ts`)

1. **`listProjects`** — `createServerFn({ method: 'GET' })`, `attachSupabaseAuth` + `requireSupabaseAuth`.
   - Input (zod): `{ companyId: uuid, search?: string(≤120), phase?: enum, archetype?: enum(7), department?: enum(9), page: int≥1 default 1 }`.
   - **Guard: `is_company_member(companyId)` → throws `httpError(403, "forbidden")` on false** (matches `getProjectCreationAccess`; makes tenant-hopping visible in logs, no silent empty).
   - Query via `context.supabase` (RLS enforces same-company; no service key):
     - `department` set → prefetch `project_departments.project_id` where `department = X` and `.in('id', ids)`; empty list short-circuits `{ rows: [], total: 0 }`.
     - `search` → `.or("name.ilike.%q%,code.ilike.%q%")` with `%`, `_`, `,` escaped.
     - `phase`, `archetype` → `.eq(...)`.
     - Join `project_admin:profiles!projects_project_admin_id_fkey(id, full_name, email, avatar_url)`.
   - Pagination: `.range((page-1)*24, page*24 - 1)`, `count: 'exact'`. Returns `{ rows, total, page, pageSize: 24 }`.

2. **`exportProjectsCsv`** — same input minus `page`, same auth + 403 guard + filter logic. Returns `{ filename: 'projects-<iso>.csv', csv: string }` (DTO — createServerFn can't stream `Response`). RFC-4180 escaping. Columns: `code,name,archetype,phase,status,capacity_mw,capacity_mwh,site_country,target_cod,project_admin`. Leading comment: `// TODO(Batch 12): consult project_export_locks before returning CSV.`

### New component (`src/components/projects/phase-badge.tsx`)

Props `{ phase: ProjectPhase }`. Token variants: development=secondary, ntp=accent, cod=primary, handover=muted. Label via `PHASE_LABELS`.

### New route (`src/routes/_authenticated/projects.index.tsx`)

- `validateSearch`: plain zod (no `@tanstack/zod-adapter` in repo) — `{ q, phase, archetype, department, page }` all with `.catch()` defaults; component clamps to known enum sets.
- `head()`: app-specific title/description/og.
- Reads `useActiveCompany()` for `companyId`; `Route.useSearch()` for filters.
- `useQuery({ queryKey: ['projects', companyId, filters], queryFn: () => listProjectsFn({ data: {...} }), enabled: !!companyId, placeholderData: keepPreviousData })`.
- Filter bar: debounced search `Input` (300 ms → `navigate({ search, replace: true })`), 3 `Select`s (Phase/Archetype/Department each with "All" = clear), `Link` "New project" → `/projects/new`, "Export CSV" button (calls `exportProjectsCsvFn`, builds `Blob`, triggers `<a download>` click).
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Card: name+code, archetype badge (label from `ARCHETYPES` catalog — "Green H₂", "C&I Rooftop"), `"{mw} MW"` + `" · {mwh} MWh"` when set, `format(target_cod, 'PP')`, `<Avatar>` + admin name, `<PhaseBadge>`. Whole card is a `<Link to='/projects/$projectId' params>`.
- States: 6-card skeleton on load; distinct empty ("No projects yet — create your first project" + CTA) vs no-matches copy when filters active; branded error panel with `refetch()`.
- Pagination footer when `total > 24`.

### Verification checklist (Playwright as demo-admin, then Test Co B)

1. Typecheck + `bun test:unit` pass.
2. `/projects` shows Prairie Winds card: name, PWS-2026, Utility PV badge, "150 MW", COD date via `PP`, avatar + name, Development badge.
3. `?phase=development` → shows it; `?phase=cod` → no-matches; `?q=prairie` → shows it; reload preserves URL.
4. Switch to Test Co B → empty state "No projects yet — create your first project".
5. Export CSV → downloads file containing Prairie Winds row (headers correct).
6. "New project" navigates to wizard; skeleton renders on slow load; PhaseBadge variants visually match tokens.
7. Direct-invoke `listProjects` with a foreign `companyId` → 403 in response + audit trail (spot-check via server logs).

### Deliberate scope

- Existing Prairie Winds gate row keeps its old "CoD" name (data-fix out of scope); the two source-of-truth label maps are corrected so `PhaseBadge` and all future creates render "COD".
- CSV via DTO string, not stream — matches every prior export in repo; upgrade to `src/routes/api/*` later if payloads grow.
- No `@tanstack/zod-adapter` install — plain `validateSearch` with `.catch()` defaults + component-side clamp keeps deps minimal.
