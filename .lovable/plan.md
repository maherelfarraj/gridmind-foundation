## P-100 — Commissioning KPI dashboard

Read-only consumer of Batch 10 data. No schema changes (no `scada_telemetry` or `project_export_locks` tables exist yet — build forward-compatible stubs).

### New files

**`src/lib/commissioning-kpis.functions.ts`** — single `getCommissioningKpis` server fn (`requireSupabaseAuth`, zod `{ project_id }`, RLS-scoped reads via `context.supabase`). Returns:

- `mcCod`: `{ mc_date, cod_date, days | null, elapsed_since_mc | null, projected_cod | null (projects.target_cod), state: 'empty' | 'mc_only' | 'complete' }`
- `prAtCod`: `{ source: 'certificate' | 'performance_test' | null, measured, contract, delta, passing }` — prefer `commissioning_certificates.payload.pr_at_cod` on signed COD row; fallback to newest `performance_tests` where `test_type='performance_ratio'` and `status='complete'`; reuse `isPassingPr` from `commissioning-certificates.rules.ts`
- `punchClosure`: `[{ category: 'A'|'B'|'C', total, closed, open_refs: string[] }]` from `qaqc_punch_items` (closure = `status='closed'` per P-096)
- `availability`: `{ state: 'awaiting_scada', cod_date }` — designed empty state, never fabricated
- `testSummary`: `{ [test_type]: { passed, failed, in_progress, not_started } }` from `commissioning_tests`
- `turnoverStatus`: `{ status, compiled_at, delivered_at } | null` from `turnover_packages`

Cross-tenant lookups return `notFound()`. Concurrent queries via `Promise.all`.

**`src/lib/commissioning-kpis.rules.ts`** — role gates (`canViewKpis` — all listed roles), CSV serializer for the four tiles + summary.

**`src/routes/_authenticated/projects.$projectId.commissioning.kpis.tsx`** — route with:
- `loader` → `ensureQueryData` (5-min `staleTime`)
- `useSuspenseQuery` in component; `errorComponent` + `notFoundComponent`
- 4 KPI tiles (grid) each with skeleton/empty/error-retry: MC→COD days, PR at COD (pass/fail badge), Punch closure % (Recharts stacked bar, category A emphasized via semantic `--destructive` token, tooltip lists open refs), Availability empty state
- Secondary strip: test summary counts by `test_type` + turnover status chip
- "CSV snapshot" button — client-side blob download; forward-compat comment referencing future `project_export_locks` guard

**Header link** — add "KPIs" to `projects.$projectId.commissioning.tsx` nav.

### Tests

**`tests/unit/commissioning-kpis.test.ts`** — pure helpers only:
- MC-only vs both-signed date math (`mcCod` state machine)
- PR source-preference selection (certificate wins over perf test)
- Punch closure % rollup by category
- CSV serialization shape

### Explicit non-goals

- No new tables/migrations. Availability tile is a designed placeholder until Batch 11 ships `scada_telemetry`.
- No snapshot-to-audit action in v1 (spec says "if you add"); skip unless requested — keeps the route strictly read-only.
- No changes to existing commissioning modules.

### Verification

`bun run test:unit` (new tests pass), typecheck, manual: MC-only project → shows elapsed + projected chip; signed COD → days computed; cross-tenant project id → not-found; CSV downloads with current values.
