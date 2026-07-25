# Launch Sequence: A → B → C

Execute the three go-live moves in strict order. Each phase must fully pass before the next begins; a failure halts the sequence and we fix in place.

## Phase A — Quality Gate (green-light the RC commit)

Goal: every check in `docs/launch-checklist.md` §5 passes on the current commit.

1. `bun run lint` — fix any warnings; enforce console hygiene (no `console.log` in `src/**`).
2. `bun run build` — resolve any type or bundler errors; no Worker-runtime incompatibilities.
3. `bun run test` (unit, `vitest.config.ts`) — all green, including:
   - `service-role-hygiene.test.ts` (P-132 static scan)
   - `public-guard.test.ts`, `rate-limit.test.ts`, `permissions.test.ts`
   - calculators, rules, schema tests
4. `bun run test:all` (`vitest.config.all.ts`) with the dev server actually running — confirm the run log lists tests under `tests/api/`, `tests/rls/`, and `tests/e2e/` (a `0 tests` suite = harness skipped = NOT ticked).
5. Fix-forward loop: for each failure, diagnose → patch → rerun only the failing suite → then rerun the full gate once at the end to confirm no regressions.

Exit criteria: 4/4 commands clean on one commit, no skipped suites.

## Phase B — Production Cut (clean DB from migrations)

Goal: fresh production database built purely from `supabase/migrations/*.sql`, seeded minimally, re-verified.

1. Confirm migration ledger: list all files under `supabase/migrations/` in lexical order and record the final filename as the target head.
2. Pre-cut sweep on the current DB (informational only):
   - Confirm no `demo-%`, `e2e-%`, `fixture-%` company slugs will carry into prod.
   - Confirm `docs/launch-checklist.md` §4 (Seed & Demo Cleanup) queries return zero.
3. Provision the production database and run every migration top-to-bottom in one transaction per file. No hand-edits, no skipped files.
4. Post-migration verification (SQL, read-only):
   - RLS enabled on 100% of `public.*` tables (expect the P-117 "10/10" and every subsequent module still at 100%).
   - GRANTs present for every public table per the "public-schema grants" rule.
   - `audit_log_retention_policies` has `retention_days >= 2555` for the six financial entities.
   - `has_role()` function exists; `user_roles` populated for the initial admin only.
5. Seed the minimum viable production state:
   - One real tenant company (no `demo-*` slug).
   - Initial admin user + `user_roles` row.
   - No fixture/demo data.
6. Re-run Phase A's `bun run test:all` against the production DB connection to confirm RLS + guard behavior on the live schema (read-only tests; destructive tests stay on the test project).

Exit criteria: production DB matches migrations head, 100% RLS, seed is real-only, `test:all` green against prod.

## Phase C — 14-Day Warn → Block + Signoff

Goal: complete `docs/launch-checklist.md` §2 and §6 exactly as written.

1. Set `PUBLIC_HOOK_ENFORCE=warn` in the Lovable Cloud secret store; redeploy.
2. Daily for 14 consecutive days:
   - Review `/admin/health` for `public_hook.ip_denied` and `public_hook.signature_failed`.
   - Cross-check `audit_logs` rows with `action` prefix `public_hook.`.
   - Resolve each denial by (a) adding integrator CIDR to `PUBLIC_HOOK_IP_ALLOWLIST`, (b) rotating/reissuing the API key + HMAC secret, or (c) confirming the caller was hostile and leaving it denied.
3. Confirm **zero legitimate-traffic denials for the final 7 consecutive days** of the window.
4. Flip: set `PUBLIC_HOOK_ENFORCE=block`; redeploy.
5. Live verification (from the checklist):
   - Bad API key → HTTP 401 (curl in §2).
   - Off-allowlist IP with valid signature → HTTP 403.
6. Confirm rollback path is one secret change (`block` → `warn`) with no code deploy required; note in the ops log.
7. Walk the full launch checklist top-to-bottom; collect signatures from Engineering Lead, Security Owner, Operations Owner in the §6 table.
8. On full signoff, proceed with DNS cutover to **gridmindepc.com** per the ops runbook.

Exit criteria: `PUBLIC_HOOK_ENFORCE=block` live, 401/403 verified, three signatures recorded, DNS cutover approved.

## Technical Details

- Test commands are fixed by P-129 / the launch checklist: `bun run test` = unit, `bun run test:all` = full (unit + api + rls + e2e). Do not invent new names.
- `test:all` requires the dev server; use the existing `tests/helpers/dev-server.ts` harness — a suite reporting `0 tests` means the harness didn't start and the gate is NOT satisfied.
- Migrations are the sole source of truth for the prod DB; no ad-hoc SQL, no `supabase--insert` seeding of demo rows, no schema drift.
- `PUBLIC_HOOK_ENFORCE` is a runtime secret managed via `add_secret` / `update_secret`; the code already reads it and `/admin/health` already renders both counters (P-134).
- The service-role key stays in `src/routes/api/**`, `src/integrations/supabase/{admin,server,client.server}.ts`, `src/lib/public-api/**`, and `*.functions.ts` / `*.server.ts` per the P-132 static test — Phase A will fail loudly if this regresses.

## Halt Rules

- Phase A failing → stop, fix, do not begin Phase B.
- Phase B verification failing → stop, do not seed, do not proceed to Phase C; treat as a migration bug and patch forward with a new migration file.
- Phase C denial spike in the warn window → reset the 7-day zero-denial counter; do not flip to `block` early.
