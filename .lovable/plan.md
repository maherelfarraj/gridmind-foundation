
## P-033 — Archetype picker (wizard step 1)

Build the first step of the project creation wizard. No DB writes; state lives in a sessionStorage draft.

### Route

- File: `src/routes/_authenticated/projects.new.tsx` (flat-dot convention; the app shell in this repo is `_authenticated/`, not `(app)/` — everything under it already sits behind the auth guard).
- Path: `/projects/new`.
- `validateSearch`: `zodValidator(z.object({ step: fallback(z.number().int(), 1).default(1) }))`. Clamp to 1..4 in the component.
- `Cancel` links to `/projects` (route file not yet created in P-031/P-032 — link renders as text `to="/projects"`; typecheck will pass once P-034 lands the list route. If typecheck fails today, use `<Link to=".." >` relative back-nav or a `useNavigate` handler string. Decide at implementation time based on tsgo output.)

### Draft store

- File: `src/lib/wizard-draft.ts`.
- Shape: `type ProjectDraft = { archetype?: ProjectArchetype; /* future steps append here */ }`.
- API: `readDraft()`, `writeDraft(patch)`, `clearDraft()`, plus a `useProjectDraft()` hook that:
  - Reads from `sessionStorage` under key `gridmind:project-draft:v1` inside `useEffect` (SSR-safe; never in a `useState` initializer per the execution-model rule).
  - Returns `{ draft, setDraft, clear, hydrated }`.
- Persist per-write, wrap access in try/catch, ignore quota errors.

### Server function

- New file: `src/lib/projects.functions.ts`.
- `getProjectCreationAccess = createServerFn({ method: "GET" }).middleware([attachSupabaseAuth]).inputValidator(z.object({ companyId: z.string().uuid() }).parse).handler(...)`.
  - `requireSupabaseAuth(context)`.
  - Verify caller is a member of `companyId` (reuse the `isCompanyMember` pattern from `modules.functions.ts` — copy the two helpers into the new file or extract to a shared module; prefer inline copy to keep the change scoped).
  - Load `companies.plan_tier`.
  - Call `context.supabase.rpc("has_module_access", { p_company_id, p_module: "green_hydrogen" })`.
  - Return `{ planTier: PlanTier, greenHydrogenEnabled: boolean }`.
- No mutation is performed; final creation gate re-checks in P-036.

### Components

- `src/components/wizard/archetype-picker.tsx`
  - Props: `{ planTier, greenHydrogenEnabled, value, onChange }`.
  - Renders `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`.
  - Card = `<button type="button">` wrapping shadcn `Card`; selected state = `ring-2 ring-primary`; disabled = `opacity-60 cursor-not-allowed` + "Enterprise plan required" `Badge` linking to `/settings/billing` (route may not exist yet — render as anchor `<a href="/settings/billing">` to avoid Link typecheck error).
  - Icon left, label + capacity hint + one-line description stacked right.
- `src/components/wizard/archetype-catalog.ts` — the 7 entries as a typed const array:

  ```ts
  export const ARCHETYPES = [
    { key: "utility_pv",              label: "Utility PV",              icon: Sun,            capacityHint: "MW",            description: "..." },
    { key: "standalone_bess",         label: "Standalone BESS",         icon: BatteryCharging,capacityHint: "MW + MWh",      description: "..." },
    { key: "c_and_i_rooftop",         label: "C&I Rooftop",             icon: Building2,      capacityHint: "MW",            description: "..." },
    { key: "hybrid_pv_bess",          label: "Hybrid PV+BESS",          icon: SunSnow,        capacityHint: "MW + MWh",      description: "..." },
    { key: "onshore_wind",            label: "Onshore Wind",            icon: Wind,           capacityHint: "MW",            description: "..." },
    { key: "green_hydrogen",          label: "Green H\u2082",           icon: FlaskConical,   capacityHint: "MW electrolyser", description: "...", enterpriseOnly: true },
    { key: "transmission_substation", label: "Transmission Substation", icon: Zap,            capacityHint: "MW",            description: "..." },
  ] as const;
  ```

  Use string literals with `&` (never `&amp;` / `&#38;`) and `\u2082` (never `n`, `2`, or `&sub2;`).

### Route body

Layout: page header ("New project" + step indicator "Step 1 of 4"), body renders the picker, footer with Cancel + Next.

```text
useActiveCompany() → activeCompanyId (nullable while loading)
useQuery({
  queryKey: ["project-creation-access", activeCompanyId],
  queryFn: () => getAccessFn({ data: { companyId: activeCompanyId! } }),
  enabled: !!activeCompanyId,
})
useProjectDraft()
```

States:
- No `activeCompanyId` yet OR query pending → 7 skeleton cards (shadcn `Skeleton`).
- Error → branded panel: `Card` with `border-destructive/40`, icon, message, "Try again" button calling `refetch()`. A dev-only `?forceError=1` search flag can trigger a synthetic error to demo it.
- Success → picker. Green H₂ card disabled when `planTier !== "enterprise" || !greenHydrogenEnabled`.

Next button: disabled until `draft.archetype` set. On click `navigate({ to: "/projects/new", search: { step: 2 } })`.
Cancel: `clearDraft()` then `navigate({ to: "/projects" })` (or `/` if `/projects` still doesn't typecheck).

Head metadata: unique title "New project · GridMind EPC", description, og:title/description, twitter:card.

### Styling rules

- Semantic tokens only: `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `ring-primary`, `bg-destructive/10`, etc. No hex, no `rgb(`, no arbitrary color values.
- Icons inherit `currentColor`; size via `size={20}` prop.

### Verification (after implementation, in build mode)

1. `bunx tsgo --noEmit`.
2. `rg -n "#[0-9a-fA-F]{3,8}|rgb\\(|rgba\\(" src/components/wizard src/routes/_authenticated/projects.new.tsx src/lib/wizard-draft.ts src/lib/projects.functions.ts` — expect no matches.
3. Playwright as demo-admin: land on `/projects/new`, screenshot the 7 cards, assert labels via `page.get_by_text("C&I Rooftop", exact=True)` and `page.get_by_text("Green H₂", exact=True)`; select a card, reload, confirm ring persists; visit `?forceError=1`, screenshot error panel; click Next → URL becomes `?step=2`; click Cancel → returns to `/projects` (or fallback) and sessionStorage key is cleared.
4. Gating: `supabase--read_query` to grab a growth-tier company id, switch via the CompanySwitcher, confirm Green H₂ card is disabled with the Enterprise badge; switch back and confirm it re-enables.

### Out of scope

- Steps 2–4, project row insertion, audit logging, `/projects` list route, `/settings/billing` route — all deferred to their own tickets.
