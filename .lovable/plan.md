# P-049 — E-signature flow

Schema already covers this (migration `20260724133610`): `esign_provider`, `esign_envelope_id`, `esign_status`, `esign_history`, `esign_sent_at`, `esign_completed_at`, `signed_copy_path` exist on `proposals`, plus a `status` check that includes `'sent'` and `'accepted'`. No new migration needed.

## Provider adapter

`src/lib/esign/provider.ts`
- Types: `EsignEvent = 'sent' | 'viewed' | 'completed' | 'declined' | 'voided'`; `EsignProvider` interface with `send`, `refresh`, `void`, `fetchSignedPdf(envelopeId)`.
- `getEsignProvider()` reads `process.env.ESIGN_PROVIDER` (default `'manual'`) and `ESIGN_API_KEY`; returns the adapter or `null` when misconfigured.
- **Manual adapter** (dev-mode): `send` generates envelope id `manual_<uuid>`; `refresh` reads current `esign_status` and returns it unchanged (transitions are driven by the "simulate" server fn below, not by refresh); `void` returns `voided`; `fetchSignedPdf` re-uses the P-047 generator output stored earlier and returns those bytes as the "signed copy".
- Real providers plug in later without schema change.

## Server functions (append to `src/lib/proposal.functions.ts`, all `requireSupabaseAuth` + zod)

- `sendProposalForSignature({ proposalId, signerName, signerEmail })`
  - Guards: `proposals.status === 'approved'`; caller is sales / company_admin; provider configured. Reuses `getProposalExportData` + `buildProposalPdf` (P-047) for PDF bytes.
  - Calls `provider.send`, then updates `esign_provider`, `esign_envelope_id`, `esign_status='sent'`, `esign_sent_at=now()`, `status='sent'`, appends `{at, event:'sent', actor}` to `esign_history`.
  - `writeAuditLog('proposal.esign_sent','proposal', id, { opportunity_id, envelope_id })`.
- `refreshProposalEsign({ proposalId })` — polls provider, appends any new events, applies terminal transitions via shared helper `applyEsignEvent` (see below).
- `voidProposalEsign({ proposalId, reason })` — company_admin only; calls `provider.void`, sets `esign_status='voided'`, history entry, audit `proposal.esign_voided`.
- `simulateEsignEvent({ proposalId, event })` — dev-only, only when `ESIGN_PROVIDER === 'manual'`; sales+; drives viewed → completed / declined transitions through `applyEsignEvent`.
- `getSignedCopyDownloadUrl({ proposalId })` — runs `assertExportAllowed` (42P01 → proceed), returns a signed URL from the `documents` bucket for `signed_copy_path`.

### `applyEsignEvent` helper (shared by refresh / webhook / simulate)
- Appends `{at, event, actor}` to `esign_history` idempotently (skip if last entry matches event within a small window / by provider event id).
- On `completed`: `fetchSignedPdf` → upload to `documents` bucket at `<company_id>/proposals/<proposal_id>/signed_v<version>.pdf` via service-role client (privileged storage write), set `signed_copy_path`, `esign_completed_at`, `status='accepted'`, audit `proposal.esign_completed`.
- On `declined` / `voided`: set `esign_status` accordingly, audit `proposal.esign_declined` / `proposal.esign_voided`. No status change back to `approved` (proposal remains locked; new version required).

## Webhook route

`src/routes/api/webhooks/esign.ts` — `createFileRoute('/api/webhooks/esign')` with `POST` handler.
- Parses provider payload (zod), maps to `EsignEvent`, resolves proposal by `esign_envelope_id`.
- Minimal verification now: shared-secret header check against `ESIGN_WEBHOOK_SECRET` (timing-safe compare).
- `TODO(B13/P-126): move under /api/public/, wrap in guardPublicHook + provider signature verification.`
- Loads `supabaseAdmin` inside the handler only (no top-level import); calls `applyEsignEvent`.

## UI

New card `src/components/proposals/EsignCard.tsx` mounted in the proposal builder header / right rail.
- Empty state when provider missing: "E-signature provider not configured" + hide Send.
- Send form (react-hook-form + zod): signer name + email; disabled unless `status === 'approved'`; tooltip explains dependency on CFO approval (P-046).
- Status badge (uses design tokens) + timeline from `esign_history` (icon per event, actor, timestamp via date-fns).
- Buttons: **Send for signature**, **Refresh status**, **Simulate…** dropdown (viewed / completed / declined) visible only for manual provider with "dev mode" label, **Void** (company_admin), **Download signed copy** (when `signed_copy_path`).
- All async actions: spinner + sonner success/error toasts.

Wire the card into `src/routes/_authenticated/proposals.$proposalId.tsx`. Invalidate proposal query on every mutation.

## Secrets

Request via `add_secret` after user confirms (not in same turn as explanation): `ESIGN_PROVIDER` (default `manual`, so optional), `ESIGN_API_KEY` (only if real provider), `ESIGN_WEBHOOK_SECRET` (for the webhook). For dev-mode manual flow, none are strictly required — the card renders and works with defaults.

## Verification

- Send disabled until `status='approved'`; enabling after CFO approval triggers `proposal.esign_sent` audit and `status → sent`.
- Simulate viewed → completed uploads `signed_v<version>.pdf` to `documents/<company>/proposals/<id>/`, sets `status='accepted'`, audits `proposal.esign_completed`, Download link works and passes through `assertExportAllowed`.
- Void works only for company_admin.
- Webhook route present with B13 TODO; service-role import only inside handler bodies.
- `bun run tsgo` clean.
