## P-038 — Project detail layout + phase-gate stepper

Convert `projects.$projectId` from a single page into a nested layout with tab child routes.

### New server function

Append `getProject` to `src/lib/projects.functions.ts`:

- Zod input `{ id: uuid }`, `attachSupabaseAuth` + `requireSupabaseAuth`.
- Single `.maybeSingle()` on `projects` (RLS scopes to caller's company). If null → return `null` (never distinguish "does not exist" from "wrong tenant").
- If found, parallel-fetch:
  - Caller's roles for the project's `company_id` (query `user_roles` filtered by `auth.uid()` + company).
  - `project_members` joined to `profiles` (full_name, email, avatar_url) for the badges.
  - `project_departments` (dept, status, lead_user_id) joined to `profiles` for lead names.
  - `project_phase_gates` (id, phase, name, status, sort_order) ordered by `sort_order`.
- Return a plain DTO `ProjectDetail` (all fields as strings/numbers/nulls) — never SDK objects.

### New shared component

`src/components/projects/phase-gate-stepper.tsx`:

- Props: `gates: { phase; status; name }[]`.
- Renders 4 horizontal steps in fixed order Development → NTP → COD → Handover.
- Each step matches to the gate row for that phase (fallback to `locked` if missing).
- Icon + token classes:
  - `approved` → `CheckCircle2` + `bg-primary text-primary-foreground`
  - `in_review` → `Clock` + `bg-accent text-accent-foreground`
  - `open` → outlined circle + `border-primary text-primary ring-1 ring-primary/40`
  - `locked` → `Lock` + `bg-muted text-muted-foreground`
- Connector line between steps uses `bg-border`; the segment before an approved step becomes `bg-primary`.
- Purely presentational; no click handlers (gate transitions land in P-040).

### Route split

`src/routes/_authenticated/projects.$projectId.tsx` becomes a **layout route**:

- Loader primes a `projectDetailQueryOptions(id)` via `context.queryClient.ensureQueryData`.
- `errorComponent` + `notFoundComponent` render a branded panel with retry / "Back to projects".
- Component reads `useSuspenseQuery(projectDetailQueryOptions(id))`.
  - If the fn returns `null` → render the same branded not-found panel (name-agnostic copy so tenant existence isn't leaked). This is the cross-tenant case.
  - Otherwise renders header block (name, code, archetype badge with correct "C&I Rooftop" / "Green H₂" copy, status chip, `PhaseGateStepper`) then the tab bar, then `<Outlet />`.
- Tab bar: static tabs Overview / Gates / Config always shown; department tabs (Engineering, Procurement, Construction, HSE, Finance) rendered only when a matching `project_departments` row exists. Uses `<Link>` with active-state token styling; no manual URL strings.
- `pendingComponent` shows skeleton header + tab bar.

New child route files (all import a shared `projectDetailQueryOptions` from `src/lib/projects-detail-query.ts`):

- `projects.$projectId.index.tsx` — `beforeLoad` throws `redirect({ to: '/projects/$projectId/overview', params })`.
- `projects.$projectId.overview.tsx` — `bg-card` grid of key facts (capacity_mw with `MW`, appended `· X MWh` if set, site_name/site_country, offtaker, target_cod formatted `PP`, team avatars from members).
- `projects.$projectId.gates.tsx` — placeholder card "Gate transitions ship in P-040" listing gate names + statuses read-only.
- `projects.$projectId.config.tsx` — placeholder card "Archetype config ships in P-039".
- `projects.$projectId.engineering.tsx`, `.procurement.tsx`, `.construction.tsx`, `.hse.tsx`, `.finance.tsx` — each reads its department row from the shared query and renders a placeholder panel (department status badge, lead name from profile, copy "This module ships in a later batch"). If the row is missing (URL was hand-typed for a hidden dept), render a small "Department not assigned to this project" panel instead of crashing.

### Shared query options module

`src/lib/projects-detail-query.ts` exports:

```ts
export const projectDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['project-detail', id],
    queryFn: () => getProject({ data: { id } }),
    staleTime: 30_000,
  });
```

This lets layout + every child tab share the cache with `useSuspenseQuery` — one RPC per navigation into the project, no per-tab fetch.

### Head metadata

Layout `head()` uses the loaded project (name + code) for title, description, `og:title`, `og:description`, `og:type=website`, `twitter:card=summary`. Fallback to generic "Project — GridMind EPC" when data isn't in cache yet (SSR/prefetch).

### Verification (manual + Playwright)

1. `/projects/{prairie-id}` as Demo Admin → header shows "Prairie Winds Solar — 150 MWac", `PWS-2026`, `Utility PV` badge, stepper with Development ring/open + NTP/COD/Handover muted/locked.
2. Tab bar shows Overview, Gates, Config plus the 5 departments seeded at creation; no other dept tabs visible.
3. Overview panel shows 150 MW, site, offtaker, target COD, member avatars.
4. Hand-type same URL while signed in as Test Co B → branded not-found panel with "Back to projects", no name leaked.
5. Reload with network throttled → skeleton header/tabs render before content.
6. Kill the RPC (temporarily flip the id to a non-uuid via URL) → error boundary shows retry button that calls `router.invalidate()`.
7. `rg -n "#[0-9a-fA-F]{6}\\|rgb\\(\\|text-white\\|bg-black" src/components/projects src/routes/_authenticated/projects.\\$projectId*` returns no hits (tokens only).

### Non-goals

Read-only page: no mutations, no audit rows, no gate transitions (P-040), no archetype config forms (P-039).
