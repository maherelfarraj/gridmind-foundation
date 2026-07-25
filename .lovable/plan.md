## P-094 — Test execution capture (mobile)

Mobile-first execution screen for a single `commissioning_tests` row. Adaptive by `test_type`, server-enforced witness rule, offline queue, and audited re-open.

### 1. Server (`src/lib/commissioning.functions.ts` — extend)

Add three `createServerFn` handlers with `requireSupabaseAuth`, zod input, and `writeAuditLog`:

- **`getCommissioningTestForExecute({ testId })`** — RLS-scoped SELECT; returns `{ test, canExecute, canReopen }` or `{ test: null }` for hidden/cross-tenant (drives branded not-found panel).
- **`saveCommissioningTestResult({ testId, status: 'passed'|'failed', result, notes?, clientIdempotencyKey })`** — wrapped in `withIdempotency`. Reloads the row, verifies executor roles (`field_technician|foreman|engineer|construction_admin`), then:
  - If `utility_witness_required && status === 'passed'` and (`witness_file_path` null OR `utility_witnessed_at` null OR `utility_witness_name` empty) → `httpError(409, 'witness_required', 'Utility witness record required to pass this test')`.
  - Sets `started_at` (if null → now), `completed_at = now()`, `status`, `result`.
  - Audit `commissioning.test_executed` with `{test_type, status}`.
- **`recordUtilityWitness({ testId, witnessName, witnessFilePath })`** — validates the storage path belongs to `{company_id}/witness/{project_id}/{test_id}/…` (matches storage policy). Sets `utility_witness_name`, `utility_witnessed_at = now()`, `witness_file_path`. Audit `commissioning.witness_recorded`.
- **`reopenCommissioningTest({ testId })`** — construction_admin only. Only when `status in ('passed','failed')`. Clears `completed_at`, sets `status='in_progress'`. Audit `commissioning.test_reopened`.

`httpError` already returns `{ statusCode, body: { error } }` which the error middleware passes through; matches the "numeric statusCode 409" contract.

### 2. Storage (closeout bucket)

Bucket exists; verify/add policy so `authenticated` members of the folder's company can INSERT/SELECT under `closeout/{company_id}/witness/**` (uses existing `storage_company_id` helper). If policy is absent, ship it as a small migration in this task.

Client upload path: `${company_id}/witness/${project_id}/${test_id}/${uuid}-${filename}`.

### 3. Route

File (follows repo's flat dot-notation convention, not directory nesting):
`src/routes/_authenticated/projects.$projectId.commissioning.tests.$testId.execute.tsx`

- `head()` with unique title/description/og.
- Loader: `context.queryClient.ensureQueryData` on the test-for-execute query.
- Branded not-found panel when `test === null` (cross-tenant / hidden).
- Skeleton, inline error banner + sonner toast for mutation failures.

### 4. Adaptive result form (react-hook-form + zod, sticky bottom save bar, `min-h-11` inputs)

Discriminated-union zod schema on `test_type`:

- `insulation_resistance` → `testVoltageVdc`, `measuredMohm`, `ambientC`, `passThresholdMohm`. Auto-suggest status: pass if `measuredMohm >= passThresholdMohm`.
- `hipot` → `testVoltageKv`, `durationS`, `leakageMa`, `breakdown: boolean`. Breakdown → failed.
- `string_test` → repeater of strings `{ label, vocV, iscA, polarityOk, passed }`.
- `iv_curve` → editable grid `{voltageV, currentA}` with "Add row" and "Paste CSV" (accepts `V,I` per line). Client-side compute stored in `result.summary`:
  - Sort by V asc. `Voc` = V where I≈0 (linear interp between the two straddling points, or last row if monotonic).
  - `Isc` = I where V≈0 (linear interp).
  - `Pmax = max(V*I)` across points; `FF = Pmax / (Voc*Isc)`.
  - Persist `result.iv_points` (array) + `result.summary` (Voc, Isc, Pmax, FF).
- `continuity | earth_resistance | functional | other` → `measuredValue`, `unit`, `notes`.

Two buttons in sticky bar: **Mark failed** / **Mark passed** (both submit through same mutation).

### 5. Utility witness block

Visible when `utility_witness_required`. Empty state: "No witness recorded yet". Fields: witness name, file input (image/pdf). On submit:
1. Upload to `closeout` via `supabase.storage`.
2. Call `recordUtilityWitness`.
3. Invalidate query.

After success, pass button becomes enabled with a shield-check hint. If a user still tries to pass without witness (or offline drift), the 409 surfaces as an inline banner ("Utility witness required") + toast.

### 6. Offline

- Register two dispatchers in `src/lib/offline/dispatch.ts`:
  - `commissioning.save_result → saveCommissioningTestResult`
  - `commissioning.record_witness → recordUtilityWitness`
- Save-flow: try direct call; on network failure (offline / TypeError) → `enqueueMutation({ entity:'commissioning', action:'save_result', payload })` and show queued badge. Same for witness (photo blob path handled via existing `enqueuePhotoBlob` pattern — but since the closeout upload needs to happen first, when offline we stash the blob under a generated object path, enqueue an upload+record combo through a new `commissioning.upload_and_record_witness` dispatcher). Simplest: queue only the DB call and require online for the storage upload; document that witness photos need connectivity. (Confirming this trade-off — see Q1 below.)
- Toast + `OfflineBadge`-style chip on the page shows "Queued — will sync" / "Synced".

### 7. Completed / re-open

When `status in ('passed','failed')`: render read-only summary (all fields disabled, IV chart if applicable). "Re-open test" button visible only to `construction_admin`; confirms then calls `reopenCommissioningTest`, invalidates, and re-renders editable form.

### 8. IV math sanity check (implementation note)

Reference points to verify by hand: V=[0,10,20,30,35,38,40], I=[8.2,8.1,8.0,7.5,6.0,3.0,0]. Expected Voc≈40, Isc≈8.2, Pmax≈max(V*I)=225 at V=30, FF≈225/(40*8.2)=0.686.

### 9. Files touched

- `src/lib/commissioning.functions.ts` — +4 handlers, IV summary helper exported for tests.
- `src/lib/offline/dispatch.ts` — register commissioning dispatchers.
- `src/routes/_authenticated/projects.$projectId.commissioning.tsx` — row click → link to execute route.
- `src/routes/_authenticated/projects.$projectId.commissioning.tests.$testId.execute.tsx` — new.
- `supabase/migrations/0046_closeout_witness_policy.sql` — only if bucket policy is missing (I'll verify first turn of build mode).
- `tests/unit/iv-curve.test.ts` — unit test for Voc/Isc/Pmax/FF.

### Open question

**Q1.** Witness photo upload when offline: the storage upload requires network. Two options:
- **A (planned):** Require online for the witness upload step; keep only the metadata mutation queueable. Field crew can still save pass/fail on witness-not-required tests fully offline.
- **B:** Stash the blob in IndexedDB and upload+record as a two-step dispatcher when back online (more code, matches DPR photo pattern).

Default is A unless you say B. Please confirm.
