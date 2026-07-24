## P-035 — Wizard step 3: template selection (gates, budget lines, departments)

Extend the wizard route with step 3. User picks a template (or "Start blank"), reviews & edits the resolved phase gates, budget lines, and departments, and everything goes into the sessionStorage draft. No project rows are created here — P-036 handles the insert.

### Migration: seed 7 system templates

New migration `seed_system_project_templates.sql` inserts one `is_system=true` row per `project_archetype` value, owned by the Demo EPC Co. company (system templates for now scoped to the demo tenant — a later batch can promote to null-company system rows once the RLS model supports it).

- Read Demo EPC Co. `companies.id` inside the migration via a `WITH demo AS (SELECT id FROM companies WHERE name = 'Demo EPC Co.' LIMIT 1)` CTE; skip the seed cleanly if no such company exists (defensive `WHERE EXISTS`).
- `default_gates` shape (jsonb array):
  ```json
  [
    { "phase": "development", "name": "Land control secured", "sort_order": 1 },
    { "phase": "development", "name": "Interconnection queue position", "sort_order": 2 },
    { "phase": "ntp",         "name": "Financing close",                "sort_order": 3 },
    { "phase": "ntp",         "name": "EPC contract signed",             "sort_order": 4 },
    { "phase": "cod",         "name": "Mechanical completion",           "sort_order": 5 },
    { "phase": "cod",         "name": "Grid energisation",               "sort_order": 6 },
    { "phase": "handover",    "name": "Punch-list closed",               "sort_order": 7 }
  ]
  ```
  Per-archetype variants add one or two specific gates (e.g. `standalone_bess` adds "Augmentation plan approved" in CoD; `green_hydrogen` adds "Offtake certification" in NTP; `transmission_substation` adds "SCADA integration test" in CoD; `hybrid_pv_bess` gets both PV and BESS energisation gates).
- `default_budget_lines` shape (jsonb array): `[{ "category": "EPC", "code": "MOD",  "label": "Modules",        "share": 0.35 }, ...]`. Shares sum to 1.0 per template. Categories: `EPC`, `BOS`, `DEV`, `OWN`. Per-archetype variants:
  - PV/hybrid: modules, inverters, trackers, structure, BOS, dev/permit, contingency.
  - BESS: battery packs, PCS, containers, BOS, dev/permit, contingency.
  - Wind: turbines, foundations, collection, BOS, dev/permit, contingency.
  - Substation: primary equipment, protection & control, civils, engineering, contingency.
  - Rooftop C&I: modules, inverters, mounting, install, dev, contingency.
  - Green H₂: electrolyser, BOP, compression/storage, EPC install, dev, contingency.
- `default_departments` (`project_department[]`): all 7 templates ship with `{engineering, procurement, construction, hse, finance, legal, om, scada, billing}` minus obviously N/A ones (e.g. rooftop C&I drops `scada`; substation-only drops `billing`; keep it simple — sensible defaults, users edit in the wizard).
- Idempotent: `INSERT ... ON CONFLICT (company_id, name, archetype) DO NOTHING`.

Migration description will explain plainly: seeds default project templates for each project type covering typical phase-gate checklists, budget categories, and involved departments.

### Shared schema additions

Extend `src/lib/schemas/project-wizard.ts`:

```ts
export const gateSchema = z.object({
  phase: z.enum(["development", "ntp", "cod", "handover"]),
  name: z.string().trim().min(1).max(120),
  sort_order: z.coerce.number().int().min(0).max(9999),
});
export const budgetLineSchema = z.object({
  category: z.string().trim().min(1).max(24),
  code: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(120),
  share: z.coerce.number().min(0).max(1),
});
export const departmentEnum = z.enum([
  "engineering","procurement","construction","hse",
  "finance","legal","om","scada","billing",
]);
export const projectSelectionSchema = z.object({
  template_id: z.string().uuid().nullable(),
  gates: z.array(gateSchema).min(1, "At least one gate required"),
  budget_lines: z.array(budgetLineSchema).min(1, "At least one budget line required")
    .refine(
      (lines) => Math.abs(lines.reduce((s, l) => s + l.share, 0) - 1) < 0.005,
      "Budget line shares must sum to 100%",
    ),
  departments: z.array(departmentEnum).min(1, "Pick at least one department"),
});
export type ProjectSelection = z.infer<typeof projectSelectionSchema>;
```

### Server function

New export in `src/lib/projects.functions.ts`: `listProjectTemplates`.

- Input: `{ companyId: uuid, archetype: project_archetype }`.
- Middleware: `attachSupabaseAuth`, then `requireSupabaseAuth`, plus `is_company_member` RPC guard (matches `getProjectCreationAccess`).
- Query: `context.supabase.from('project_templates').select('id,name,description,is_system,default_gates,default_budget_lines,default_departments').eq('company_id', companyId).eq('archetype', archetype).order('is_system', {ascending: false}).order('name')`.
- Returns plain DTO `Array<{ id, name, description, isSystem, gates: Gate[], budgetLines: BudgetLine[], departments: string[] }>`. Parse jsonb through the shared zod schemas server-side; any bad row is dropped with a `console.warn` (not thrown — a corrupt template shouldn't block the wizard).

### Draft store

Extend `src/lib/wizard-draft.ts`:

- Add `selection?: ProjectSelection` to `ProjectDraft`.
- No revival needed (no `Date` fields).

### Components

`src/components/wizard/template-picker.tsx`

- Props: `{ templates: TemplateOption[]; value: string | null; onChange: (id: string | null) => void }`.
- Renders a responsive grid (`grid-cols-1 md:grid-cols-2`) of cards: one per template plus a "Start blank" card as the last option (`id === null`). Card content: name, `is_system` badge, description, and a small footer showing gate/budget/dept counts. Selected = `ring-2 ring-primary border-primary/40`. Same semantic-token pattern as archetype picker.

`src/components/wizard/gates-editor.tsx`

- Controlled `{ value, onChange }` for the gates array.
- Renders one section per `project_phase` (Development / NTP / CoD / Handover) with the gates in that phase, sortable by `sort_order` (kept in insertion order; +/- buttons reorder within the phase and reassign `sort_order` on change).
- Each row: `Input` for name, a small `Select` for phase (moves gate between phase groups), and a trash button. Add-gate button per phase pre-fills phase + next `sort_order`.
- Inline `text-destructive` message when zero gates remain.

`src/components/wizard/budget-lines-editor.tsx`

- Table-like list with `code`, `label`, `category` (`Select` from `EPC/BOS/DEV/OWN`), and a `share` number input (percent display; internally stored 0..1). Live "Total: 92.5% — must sum to 100%" summary in `text-muted-foreground`, turning `text-destructive` when off.
- "Add line" and delete-row controls. "Normalize to 100%" helper button that scales all shares proportionally.

`src/components/wizard/departments-picker.tsx`

- 9 department checkboxes (`Checkbox` from shadcn) in a `md:grid-cols-3` grid with human-readable labels ("Engineering", "Procurement", "Construction", "HSE", "Finance", "Legal", "O&M", "SCADA", "Billing").

`src/components/wizard/project-selection-form.tsx`

- Composes the four components. State via `useForm<ProjectSelection>({ resolver: zodResolver(projectSelectionSchema), mode: 'onChange' })`.
- When the user selects a template: `form.reset({ template_id, gates: template.gates, budget_lines: template.budgetLines, departments: template.departments })`, but only if the current form is untouched or the user confirms via a `AlertDialog` — otherwise picking a template silently would wipe their edits. Track "user has modified since template load" with a ref updated on any field change; show the confirm dialog only when true.
- "Start blank" resets to a minimal shape: one gate (`{phase: 'development', name: 'Kickoff', sort_order: 1}`), one budget line (`{category:'EPC', code:'TOT', label:'Total EPC', share:1}`), and departments = `['engineering']`.
- Footer: Back + Next buttons. Next disabled unless `formState.isValid`.

### Route wiring

Update `src/routes/_authenticated/projects.new.tsx`:

- Add step-3 branch: renders `ProjectSelectionForm`. Same guard rule as step 2 — if `hydrated && !draft.archetype`, effect redirects to step 1; add `&& !draft.basics`-based redirect to step 2 so users can't skip basics.
- Load templates with `useQuery` (`enabled: !!activeCompanyId && !!draft.archetype && currentStep === 3`) calling `listProjectTemplates` via `useServerFn`. Show skeleton grid while pending, branded error panel on error (mirroring step 1's pattern; extract the error panel into `src/components/wizard/error-panel.tsx` while at it since we now have three call sites).
- On submit: `setDraft({ selection: values })` then `navigate({ to: '/projects/new', search: { step: 4 } })`.
- Update the step subtitle map to include step 3: "Pick a template, then adjust the gates, budget lines, and teams involved."
- Steps 4+ keep the existing "Coming soon in P-036" panel (rename the copy from P-035 → P-036).

### Design & copy rules

- Semantic tokens only. Icons via lucide-react (`ChevronUp/Down`, `Trash2`, `Plus`, `Percent`, `LayoutTemplate`).
- Preserve `C&I` and `Green H₂` spelling everywhere.
- Currency-free: `share` shown as percent, not money — no currency selector in this step.

### Verification (after switching to build mode)

1. `bunx tsgo --noEmit`.
2. `rg -n "#[0-9a-fA-F]{3,8}|rgb\(|rgba\(" src/components/wizard src/lib/schemas src/lib/projects.functions.ts src/routes/_authenticated/projects.new.tsx` — no matches.
3. Unit tests in `tests/unit/project-selection-schema.test.ts`: (a) selection with sum≈1 passes, (b) sum=0.9 fails with the shares message, (c) empty gates/departments fails, (d) invalid phase enum fails.
4. `supabase--read_query` after the migration approves: `SELECT archetype, name, jsonb_array_length(default_gates), jsonb_array_length(default_budget_lines), array_length(default_departments,1) FROM project_templates ORDER BY archetype` — expect 7 rows and non-zero counts.
5. Playwright as demo-admin: go through step 1 → step 2 → step 3, confirm 7 archetype-appropriate templates load, "Start blank" resets the form, adding a budget line and watching the total percent flip red/green, reload preserves the draft, direct-visit `?step=3` with cleared sessionStorage redirects to step 1, and Next lands on step 4 (Coming soon).

### Out of scope

- Step 4 (review + confirm), the final DB insert, audit log rows, custom (user-created) templates, cross-tenant / null-company system templates, budget line currency conversion — all deferred to P-036 and later.
