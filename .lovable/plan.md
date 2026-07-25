## What to build

The Care/Custody/Control (CCC) ceremony that closes the project: prerequisite gauntlet → dual-signed CCC certificate → auto-driven Handover phase gate → project advances to `handover` / `status='completed'`, unlocking O&M/SCADA (Batch 11). Read-only, immutable gate history rendered straight from `audit_logs` (append-only; DB triggers from Batch 04 already log every gate/phase change).

## Migration — `0047_handover_gate_checklist.sql`

The existing `handover` gates in the DB only have `punch_list_closed` in their checklist. Realign so the P-040 engine's `checklist_incomplete` guard actually gates on the CCC + turnover.

- Update every existing `project_phase_gates` row where `phase='handover'` so `checklist` becomes the three items below (preserving `done`/`done_by`/`done_at` for any pre-existing key).
- Update the template used when new projects are seeded (search for the seeder in the `handover` migration; adjust its default JSON to match).

Checklist template:

```text
[
  { key: "ccc_signed",         label: "Care, Custody & Control certificate signed", required: true },
  { key: "turnover_delivered", label: "Turnover pack delivered",                    required: true },
  { key: "punch_list_closed",  label: "Category A punch list closed",               required: true }
]
```

No table/schema DDL; policies unchanged.

## Server logic

### `src/lib/handover.rules.ts` (new)

- `HandoverPrereqKey = 'cod_signed' | 'no_open_category_a_punch' | 'turnover_delivered'`
- `HANDOVER_REASON_LABELS: Record<HandoverPrereqKey, string>` (reason strings surfaced on the client)
- `cccTransferPayloadSchema` — zod: `epc_entity_name`, `owner_entity_name`, `effective_at` (ISO), `scope_notes` (max 2000), `witness_notes?`
- `signCccTransferInputSchema` — `{ projectId, certificateId, payload, signatures: [contractor, client, (utility?)] }` where each signature is `{ party, signer_name, signer_role?, png_data_url }` (mirrors P-097 `addSignature` shape)

### `src/lib/handover.server.ts` (new, per tanstack-serverfn-split)

Pure helpers, no `createServerFn`:

- `checkHandoverPrereqs(client, companyId, projectId)` → returns `{ passes: HandoverPrereqKey[], reasons: { key, label }[] }` by concurrently querying:
  1. `commissioning_certificates` where `certificate_type='cod'` and `status='signed'` for the project.
  2. `qaqc_punch_items` open Category A count (reuses the same predicate `assertNoOpenCategoryAPunch` uses internally — factor a helper `hasOpenCategoryAPunch()` in that module and import it here so no logic duplication).
  3. `turnover_packages.status IN ('delivered','accepted')`.
- `uploadSignaturePng(client, companyId, projectId, party, dataUrl)` — writes to `closeout/{companyId}/certificates/{projectId}/ccc-{party}-{ts}.png` and returns the object path. Reuses the exact helper from P-097 if one already exists; otherwise mirrors it.
- `assembleHandoverHistory(client, companyId, projectId)` — pulls `audit_logs` where `company_id = current` AND (`entity='project_phase_gates'` and `metadata->>'project_id' = projectId`) OR (`entity='projects'` and `entity_id = projectId`) OR (`entity='commissioning_certificates'` and `entity_id IN (...)` — first fetch the project's cert ids). Order `created_at DESC`, limit 200. Joins actor `profiles(full_name,email)` in a second small query.

### `src/lib/handover.functions.ts` (new — handlers only, imports from `.server.ts`)

All wrapped with `attachSupabaseAuth` + `requireSupabaseAuth`; role gate uses `user_roles` and the existing `assertGateAdmin`/roles helpers.

- `getHandoverBoard({ projectId })` — read. Returns:
  ```text
  { project, company, branding, prereqs, cccCertificate | null,
    handoverGate, gateApprovalInstance | null, history[], permissions }
  ```
  `permissions.canExecute` = role in {construction_admin, project_admin, company_admin}; read allowed for those plus om_admin, engineer, client_viewer.
- `signCccTransfer({ projectId, certificateId, payload, signatures })` — write. Steps, in order:
  1. Load current `commissioning_certificates` row; assert `certificate_type='ccc_transfer'`, company matches, current status ≠ 'signed'.
  2. Re-run `checkHandoverPrereqs`. If any fails, throw with `statusCode: 409` and body `{ error:'handover_prereqs_failed', reasons: [...] }` (matches `httpError` shape used by `commissioning-certificates.functions.ts` so the existing error middleware passes it through untouched).
  3. Upload the two/three signature PNGs; build `signatures` array (party, signer_name, signer_role, signed_at, png_path).
  4. Update the certificate row: `payload=<zod-parsed>`, `signatures=<full>`, `effective_date=payload.effective_at::date`, `status='signed'`.
  5. `writeAuditLog('handover.ccc_signed','commissioning_certificates', certId, { project_id, effective_date, parties: [...] })` — via existing `write_audit_log` RPC.
  6. Drive the Handover gate:
     - Load `project_phase_gates` where `project_id=? AND phase='handover'`.
     - Auto-complete checklist items `ccc_signed`, `turnover_delivered`, `punch_list_closed` — set `done=true`, `done_by=auth.uid()`, `done_at=now()`; preserve unknown items untouched.
     - If `status='locked'`, flip to `'open'`. If already `'open'`, leave.
     - Inline the `requestGateTransition` logic (create `approval_instances` row, insert `approvals` rows for all `company_admin`s, set gate `status='in_review'` + `approval_instance_id`). Audit `gate.transition_requested` — the same event Batch 04's engine logs. Don't call the exported server-fn (would double-authenticate and re-validate).
  7. Return `{ certificate, gate, approvalInstanceId }`.
- No new endpoint for approve — the existing P-040 `approveGateTransition` (Batch 04) already: sets `projects.phase='handover'`, `projects.status='completed'` when `gate.phase='handover'`, logs `project.phase_change` + `gate.approved`. Reuse as-is.

Error contract: all `httpError` throws use `statusCode: 409` + JSON body with a `reasons` array so the shared TanStack error middleware forwards `{ statusCode, body }` unchanged and the client can render tooltip reasons.

## UI — `src/routes/_authenticated/projects/$projectId/commissioning/handover.tsx`

TanStack Query loader (`ensureQueryData` → `useSuspenseQuery`), `head()` with unique title/description/OG. `errorComponent` + `notFoundComponent` per Start conventions.

Empty state — when no COD certificate signed yet: card reading `Handover not started — complete COD first` with a `Link` to `/projects/$projectId/commissioning/certificates`.

Full workspace layout (semantic tokens only — `bg-card`, `text-muted-foreground`, `border-border`, `text-destructive`, `bg-emerald-500/10`, etc. — never hex):

1. **Prerequisite checklist card** — three rows (COD signed, no open Cat-A punch, turnover delivered) each with a check/x icon + tooltip on the fail reason; live from `prereqs`.
2. **CCC transfer form** — EPC legal entity, Owner legal entity, effective datetime, scope notes; two `SignaturePad` (contractor, client) + optional utility signer. Uses the P-097 `signature-pad.tsx` component untouched. Signer name inputs above each pad. Submit button `Sign & advance to Handover` — disabled unless all prereqs pass AND both required signatures are drawn AND form validates; disabled state shows a Tooltip listing the failing reasons.
3. **Handover gate card** — shows current gate status, checklist snapshot, and (once in review) `Approvers pending: N of M` from `approval_instances`/`approvals`. If gate is approved, show a success banner `Project transferred to Operations` and a `Link` to the O&M sidebar entry (existing route pattern from Batch 11 gating, keyed on `projects.phase='handover'`).
4. **Gate history timeline** — vertical list rendered from `history[]`: timestamp, actor name, action badge (`gate.transition_requested`, `gate.approved`, `handover.ccc_signed`, `project.phase_change`, `gate.rejected`, `certificate.signed`), and a metadata chip line. Newest first. No mutations available — read-only. Toast on 409 mutation errors surfaces `reasons[]`.

States: `Skeleton` cards during load; error card with retry (`router.invalidate()` + `reset()`); empty state above.

## Header wiring

Add a `Turnover pack → Handover` link in `src/routes/_authenticated/projects.$projectId.commissioning.tsx` header (next to Certificates / Turnover), using the same outline button + `KeyRound` (or `Handshake`) icon.

## Tests — `tests/unit/handover.test.ts`

- `checkHandoverPrereqs` returns all three failures when nothing done.
- Each prereq flips green independently.
- `signCccTransferInputSchema` rejects <2000-char scope notes overflow, invalid ISO date, missing parties.
- `handover.rules.ts` reason labels exist for every `HandoverPrereqKey`.
- (RLS test not needed — `commissioning_certificates` policies already covered in P-097.)

Manual QA gauntlet (from the prompt):

- [ ] CCC blocked → 409 with `reasons` while any prereq fails.
- [ ] All green → sign → `handover.ccc_signed` audited → gate → `in_review`.
- [ ] Approve gate → `projects.phase='handover'`, `status='completed'` → O&M unlocks.
- [ ] Timeline shows every phase/gate/certificate event newest-first.
- [ ] Repo grep confirms zero `UPDATE`/`DELETE` on `audit_logs`.

## Files touched

```text
supabase/migrations/0047_handover_gate_checklist.sql        (new)
src/lib/handover.rules.ts                                   (new)
src/lib/handover.server.ts                                  (new)
src/lib/handover.functions.ts                               (new)
src/lib/commissioning-punch.functions.ts                    (export helper `hasOpenCategoryAPunch`)
src/routes/_authenticated/projects.$projectId.commissioning.handover.tsx  (new)
src/routes/_authenticated/projects.$projectId.commissioning.tsx           (add header link)
tests/unit/handover.test.ts                                 (new)
```

No new tables, no new buckets, no changes to `audit_logs` (append-only preserved).
