## P-085 — Discipline board

Read-only Field ▸ Discipline board at `/field/discipline-board` that rolls up DPR quantities into a Civil / Mechanical / Electrical view per area, with SPI / CPI / manpower / weather header KPIs.

### Schema note (small migration needed)

The spec says planned qty and area come from `wbs_items`, but the current `wbs_items` table has no `planned_quantity`, `uom`, or `area` columns. I'll ship migration `0041_wbs_planned_quantity.sql`:
- add nullable `planned_quantity numeric(14,3)`, `uom text`, `area text` to `public.wbs_items`
- no policy or grant changes (existing `wbs_select` / `wbs_write` still apply)
- no backfill; missing planned_quantity ⇒ "No baseline" in the UI

If you'd rather source planned qty elsewhere, tell me and I'll rework this piece.

### Server (`src/lib/discipline-board.functions.ts`)

One `createServerFn` + `requireSupabaseAuth`, Zod-validated input `{ projectId, from, to }` (defaults to last 30 days). Returns a plain DTO — no class instances, no Response.

Pipeline inside the handler (all through `context.supabase`, RLS as caller):
1. Load submitted/approved `construction_daily_reports` in range → collect `id`s, dates, `total_manpower`.
2. Expand `quantities` jsonb into rows `{ report_date, wbs_item_id, discipline, area, qty, uom }` (JS side).
3. Join `wbs_items` for `planned_quantity`, `uom`, `area`, `discipline` fallback, `name`.
4. Load `weather_delays` in range for lost-hours totals + this-week sum.
5. Load today's `manpower_logs` via DPRs where `report_date = today` → sum `headcount`.
6. Load latest `evm_snapshots` row for project (order by `snapshot_date desc limit 1`) → `spi`, `cpi`.

Return DTO:
```ts
{
  hasDprs: boolean,
  kpis: { spi: number|null, cpi: number|null, manpowerToday: number, weatherHoursThisWeek: number },
  columns: {
    discipline: 'civil'|'mechanical'|'electrical',
    areas: {
      area: string,
      wbsName: string|null,
      uom: string|null,
      installedToDate: number,
      plannedQty: number|null,      // null ⇒ "No baseline"
      progressPct: number|null,     // null when no baseline
      rate7d: number,               // avg qty/day last 7 reporting days
      ratePrev7d: number,           // for trend arrow
    }[]
  }[]
}
```
Rate math uses distinct reporting days in the window, not calendar days, to avoid divide-by-zero on quiet sites. Disciplines outside civil/mech/elec are dropped (surfaced only if user later asks).

### UI

- Route: `src/routes/_authenticated/field.discipline-board.tsx` (public inside `_authenticated`, no per-route auth gate).
- Loader primes `ensureQueryData` with `queryOptions` keyed on `{ projectId, from, to }`.
- `errorComponent` + `notFoundComponent` on the route; skeleton via `useSuspenseQuery`.
- Filters: project `Select` (required, from existing projects query) + shadcn date-range popover (default last 30 days), URL-persisted via `validateSearch` + `loaderDeps`.
- Header KPI chips (all semantic tokens):
  - SPI / CPI — green ≥1.0 (`bg-success/10 text-success`), amber 0.9–1.0 (`bg-warning/10 text-warning`), red <0.9 (`bg-destructive/10 text-destructive`); "—" when no snapshot.
  - Manpower today (sum `manpower_logs.headcount` for today's DPRs).
  - Weather hours lost this week.
- Three columns (`grid grid-cols-1 md:grid-cols-3`) with lucide `HardHat` / `Wrench` / `Zap` headers.
- Each area card: name, `Progress` bar with % + `installed / planned uom`, KPI row `{rate7d} {uom}/day` with `ArrowUp/Down/Right` vs `ratePrev7d`. "No baseline" pill instead of bar when `plannedQty == null`.
- Empty states: per column ("No {discipline} quantities reported yet — submit a DPR."), and board-level ("No field data yet — capture your first daily report.") when `hasDprs === false`.
- CSV export button → client-side blob of the flattened `columns[].areas[]` rollup with headers `discipline,area,wbs_name,uom,installed,planned,progress_pct,rate_7d,rate_prev_7d`.
- Nav: add `Discipline board` entry under Field in `src/lib/nav-map.ts`.

Read-only page; no mutations, no audit writes, no new roles/policies.

### Files

New:
- `supabase/migrations/0041_wbs_planned_quantity.sql`
- `src/lib/discipline-board.rules.ts` (rate/progress/trend helpers, disciplines enum)
- `src/lib/discipline-board.functions.ts`
- `src/lib/discipline-board-query.ts`
- `src/routes/_authenticated/field.discipline-board.tsx`
- `tests/unit/discipline-board.test.ts` (rate/trend/progress + "no baseline" cases)

Edited:
- `src/lib/nav-map.ts` (add Discipline board entry)

### Acceptance checklist

- Three columns render; installed ÷ planned per (area, discipline).
- No baseline → text pill, no bar, no NaN/∞.
- 7-day rolling rate uses reporting days; trend arrow vs prior 7 days.
- SPI/CPI chips from latest `evm_snapshots`, threshold classes correct; today's manpower from `manpower_logs`; weather chip sums `weather_delays` this week.
- Board-level empty state when no DPRs; per-column empties when a discipline has no rows.
- CSV mirrors on-screen rollup exactly.
- Typecheck clean; new unit tests pass.
