## P-042 — CRM pipeline board + list view + KPI strip

### 1. Deps & shared bits
- `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- Add `src/lib/csv.ts` — tiny CSV escape+download helper (no papaparse).
- Add `src/lib/export-guard.ts` exporting `assertExportAllowed(supabase, { companyId, projectId? })` — queries `project_export_locks`; on Postgres `42P01` returns unlocked; other errors throw. Uses a per-request server supabase.

### 2. Sidebar / nav
- In `src/lib/nav-map.ts`, replace the placeholder CRM lifecycle item URL with `/crm/pipeline` (label stays "Develop & Sell (CRM)"). Module gating via existing `crm` moduleKey handles plan-tier and `has_module_access`; sidebar already hides items when unauthorised.
- Role visibility: sales, company_admin, finance_admin, super_admin. Implemented by extending the sidebar's role filter (or, cleaner, adding an optional `allowedRoles?: AppRole[]` field on `NavItem` and filtering in `app-sidebar.tsx` using `getCurrentUserRoles`). finance_admin still sees the link (read-only inside the page).

### 3. Server functions — `src/lib/crm.functions.ts`
All use `createServerFn` + zod `.inputValidator` + `.middleware([requireSupabaseAuth])`. All mutations call `writeAuditLog(action, entity, entity_id, { opportunity_id, ...extra })`.

- `listOpportunities({ search?, stage?, archetype?, ownerId? })` — RLS-scoped select with joins to `contacts` (owner name) via `created_by → profiles`.
- `createOpportunity(input)` — name, account_name, archetype?, capacity_mw?, estimated_value?, currency_code, expected_decision_date?, stage default `prospecting`, probability from map. Audit `opportunity.created`.
- `moveOpportunityStage({ id, stage, lossReason? })`
  - Zod refine: if `stage === "lost"` → `lossReason` required (min 3 chars).
  - Apply probability map `{prospecting:10, qualification:25, proposal:60, negotiation:80, won:100, lost:0}`.
  - Set `won_at = now()` when moving to won (clear otherwise), `lost_at = now()` + `loss_reason` when moving to lost.
  - Role gate: sales OR company_admin.
  - Audit `opportunity.stage_changed` with `{ opportunity_id, from, to, loss_reason? }`.
- `listLeads({ search?, status? })`.
- `createLead(input)` — audit `lead.created`.
- `convertLead({ leadId })` — in one transaction: insert opportunity (`stage=qualification`, `lead_id=leadId`, copy name/account/archetype/capacity), set lead `status='converted'`. Audit `lead.converted` and `opportunity.created` (both with metadata.opportunity_id).
- `getCrmKpis()` — one function returns `{ winRate, proposalCycleDays, avgDealSize, pipelineCoverage }`:
  - winRate: won/(won+lost) over trailing 12 months (null if denominator 0).
  - proposalCycleDays: try `proposals` table; on `42P01` return null; else avg `sent_at - created_at`.
  - avgDealSize: avg `estimated_value` of `won` in trailing 12 months.
  - pipelineCoverage: Σ(open estimated_value × probability/100) ÷ max(avg monthly won value × 3, 1).

### 4. Query hooks — `src/lib/crm-query.ts`
`queryOptions` for `listOpportunities`, `listLeads`, `getCrmKpis`. Mutation helpers for move/create/convert with `onMutate` optimistic updates on the opportunities query cache and `onSettled` invalidations for opps + KPIs.

### 5. UI components — `src/components/crm/`
- `CrmKpiStrip.tsx` — 4 `Card`s. Formats: percent, days (or "—"), Intl.NumberFormat currency (fallback USD), `${n.toFixed(1)}×`.
- `OpportunityCard.tsx` — name, account, archetype `Badge`, capacity MW, formatted value (Intl.NumberFormat with `currency_code`), decision date (date-fns), owner initials avatar. Uses dnd-kit `useDraggable`; when read-only, drag disabled.
- `PipelineColumn.tsx` — dnd-kit `useDroppable`; header with column label + count + sum(value). Empty column state.
- `CrmPipelineBoard.tsx` — `DndContext` with `PointerSensor` (activation distance 6); columns for the 6 stages. On drop-to-lost opens `LossReasonDialog` before firing mutation; other stages fire immediately (optimistic). Toast success/error.
- `CrmListView.tsx` — table with search/stage/archetype/owner filters, sortable columns, "Export CSV" button that first calls `assertExportAllowed` then triggers CSV download using shared helper.
- `LeadsTab.tsx` — list + "New lead" dialog + inline "Convert → opportunity" button per row.
- `NewOpportunityDialog.tsx` — react-hook-form + zod.

### 6. Route — `src/routes/_authenticated/crm.pipeline.tsx`
- `validateSearch` parses `?tab=board|list|leads` (default `board`).
- Loader: `ensureQueryData` for opportunities + KPIs (and leads when tab=leads).
- Component: `AppShell` breadcrumb "CRM › Pipeline", header with tab switcher + "New opportunity" button.
- Determines `canWrite = roles ∩ {sales, company_admin}`; `isFinanceReadOnly = has finance_admin && !canWrite`. Passes `readOnly` down to board / hides Convert & New buttons.
- Standard skeleton/empty/error states as specified.
- `head()` with unique title/description/og.

### 7. Semantic tokens & a11y
- Only `bg-background`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `bg-destructive/10`, etc. — no hex.
- Drag handles keyboard-accessible via dnd-kit `KeyboardSensor`.

### 8. Verification
- `bun run tsc` (or project typecheck) passes.
- Playwright script as demo-admin: create 2 opps, drag between columns, drag to lost blocked without reason then allowed with, KPIs render (cycle time shows "—"), CSV downloads, create+convert lead. Screenshots saved under `/tmp/browser/p042/`.

### Files touched (new unless noted)
- `src/lib/crm.functions.ts`
- `src/lib/crm-query.ts`
- `src/lib/csv.ts`
- `src/lib/export-guard.ts`
- `src/components/crm/{CrmKpiStrip,CrmPipelineBoard,PipelineColumn,OpportunityCard,LossReasonDialog,NewOpportunityDialog,CrmListView,LeadsTab}.tsx`
- `src/routes/_authenticated/crm.pipeline.tsx`
- Edit: `src/lib/nav-map.ts` (URL + optional allowedRoles field), `src/components/app-sidebar.tsx` (role filter honouring `allowedRoles`).
- `package.json` (+ 3 dnd-kit packages).
