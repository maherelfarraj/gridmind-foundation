## P-034 — Wizard step 2: basics

Extend the existing wizard route with a step-2 form. No DB writes; validated values are merged into the sessionStorage draft.

### Shared schema

New file `src/lib/schemas/project-wizard.ts`:

- Export `ProjectArchetype` re-use from `@/lib/wizard-draft`.
- Export a `makeProjectBasicsSchema(archetype: ProjectArchetype)` factory returning a `z.object({...}).superRefine(...)`.
  - Ticket shows `getDraftArchetype()` but that couples the schema to a global; a factory keeps the same shape without hidden state and stays reusable server-side in P-036 (server will pass the archetype coming from the persisted draft/insert payload).
  - Uses the exact field shape from the ticket: `name`, `code` (regex `/^[A-Z0-9-]{2,12}$/`), `capacity_mw`, optional `capacity_mwh`, `site_name/country/region`, optional `site_lat/lng`, `offtaker`, `target_cod`.
  - `target_cod` refined to be strictly in the future.
  - `superRefine`: if archetype is `standalone_bess` or `hybrid_pv_bess`, require `capacity_mwh`.
- Export a `suggestProjectCode(name: string, year = new Date().getFullYear())` helper: take up to 3 uppercase alphanumeric initials of the words in `name`, join, append `-<YYYY>`, clamp to the 2–12 char regex (fallback to `PRJ-<YYYY>` when name yields nothing).
- Export `type ProjectBasics = z.infer<ReturnType<typeof makeProjectBasicsSchema>>`.

### Draft store update

`src/lib/wizard-draft.ts`:

- Extend `ProjectDraft` with an optional `basics?: ProjectBasics` field (typed against the schema output). Dates round-trip as ISO strings in sessionStorage — add a small `reviveDraft` step in `readDraft` that converts `basics.target_cod` back to a `Date` if it's a string. Keep `writeDraft` unchanged; `JSON.stringify` already turns `Date` into ISO.
- No API change to `useProjectDraft`.

### Form component

New file `src/components/wizard/project-basics-form.tsx`:

- Props: `{ archetype: ProjectArchetype; defaultValues?: Partial<ProjectBasics>; onSubmit: (values: ProjectBasics) => void; onBack: () => void; }`.
- `useForm` with `zodResolver(makeProjectBasicsSchema(archetype))`, `mode: "onChange"` so Next stays disabled until valid.
- Layout: single-column shadcn `Form` inside a `Card` (`bg-card border-border`), section headers using `text-muted-foreground` uppercase labels.
  - "Identity" section: `name`, `code`. Watch `name` and, when the user hasn't manually touched `code` (track with a ref flag toggled on first `code` change), keep `code` synced with `suggestProjectCode(name)`.
  - "Capacity" section: `capacity_mw` (number input, `MW` suffix via right-aligned span). `capacity_mwh` (number input, `MWh` suffix) rendered only when `archetype` is `standalone_bess` or `hybrid_pv_bess`.
  - "Site" section: `site_name`, `site_country`, `site_region`, plus `site_lat` and `site_lng` numeric inputs in a two-column grid. Add a disabled `Button variant="outline"` labelled "Pick on map" wrapped in a shadcn `Tooltip` with content "Map picker ships in a later batch". No map dependency.
  - "Commercial" section: `offtaker`, `target_cod`.
- `target_cod` uses the shadcn Datepicker pattern from knowledge (Popover + Calendar with `pointer-events-auto`, formatted via `date-fns` `format(date, "PPP")`).
- Inline errors under each field via `FormMessage` (already `text-destructive`). Semantic tokens only; no hex/rgb.
- Footer: "Back" ghost button (calls `onBack`), "Next" primary button (`type="submit"`, disabled when `!formState.isValid`).

### Route wiring

Update `src/routes/_authenticated/projects.new.tsx`:

- Keep step-1 rendering intact when `search.step === 1`.
- When `search.step >= 2` and `!draft.archetype` (and `hydrated`), call `navigate({ to: "/projects/new", search: { step: 1 }, replace: true })` from an effect and render the skeleton in the meantime. Do not redirect before hydration to avoid clobbering a valid draft on first paint.
- When `search.step === 2` and draft has an archetype, render `<ProjectBasicsForm>`:
  - `archetype={draft.archetype}`
  - `defaultValues={draft.basics}`
  - `onBack` → `navigate({ to: "/projects/new", search: { step: 1 } })`
  - `onSubmit(values)` → `setDraft({ basics: values })` then `navigate({ to: "/projects/new", search: { step: 3 } })`
- Header copy updates: when step is 2, subtitle changes to "Tell us the basics: name, capacity, site, and target COD." Keep the step indicator (`Step {n} of 4`).
- Head metadata: leave as-is (single route, step is a search param).
- The existing step-1 access query (`getProjectCreationAccess`) still runs and remains the gate for archetype changes, but step 2 doesn't depend on it — render the form even if the query is still refetching, since the archetype is already committed in the draft.
- Steps 3 and 4 remain unhandled; a small fallback panel ("Coming soon in P-035") is fine when `search.step >= 3` to avoid a blank page, but this ticket doesn't ship them.

### Design & copy rules

- Semantic tokens only (`bg-card`, `border-border`, `text-muted-foreground`, `text-destructive`, `ring-primary`, etc.).
- Preserve `C&I` (literal ampersand) and `Green H₂` (`\u2082`) in any copy that references archetypes.
- Icons via `lucide-react` at `size={16}` or `20`.

### Verification (after switching to build mode)

1. `bunx tsgo --noEmit`.
2. `rg -n "#[0-9a-fA-F]{3,8}|rgb\(|rgba\(" src/components/wizard src/lib/schemas src/routes/_authenticated/projects.new.tsx` — expect no matches.
3. Vitest unit: add `tests/unit/project-wizard-schema.test.ts` covering (a) BESS requires MWh, (b) PV does not, (c) past `target_cod` rejected, (d) `suggestProjectCode("Prairie Winds Solar")` → matches `/^PWS-\d{4}$/`, (e) code regex accepts/ rejects samples.
4. Playwright as demo-admin: direct-visit `?step=2` with cleared sessionStorage → lands on step 1; pick Standalone BESS → step 2 shows MWh field; pick Utility PV → MWh hidden; type a past date → error; fill valid form → Next → Back → values intact; reload on step 2 → values intact; typing a name populates `code` until user edits code manually.

### Out of scope

- Steps 3–4, DB writes, audit rows, map picker, `/projects` list route — deferred.
