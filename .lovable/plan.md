## P-050 — Win flow: opportunity → project_intake + kick-off pack

### Server: `src/lib/opportunity.functions.ts`

Add `convertOpportunityToIntake` (createServerFn POST, requireSupabaseAuth, zod):
- Input: `opportunityId`, `name`, `archetype` (7 canonical enum), `capacity_mw`, `offtaker`, `target_cod`, `owner_id` (project owner profile).
- Role guard: sales / company_admin / super_admin (via `getCurrentUserRoles` pattern already in file); reject otherwise.
- Load opportunity via RLS-scoped client. If `stage='lost'` → throw `Cannot convert a lost opportunity`. If `converted_intake_id` already set → return `{ intake_id, alreadyConverted: true }` (idempotent, no writes).
- Transactional sequence (single RPC via `supabase.rpc` OR sequential with rollback-on-error using `has_role`-checked writes; use sequential — no cross-table transaction available from PostgREST, wrap in try/catch and best-effort compensation on intake insert failure since opportunity update happens last):
  1. INSERT `project_intake` (company_id, name, archetype, capacity_mw, offtaker, target_cod, source `'opportunity'` — enum has no `crm_win`, closest legal value; source_opportunity_id, status `'new'`, created_by=userId, notes=`Converted from opportunity <name>`).
  2. UPDATE `opportunities` SET stage='won', won_at=now(), probability=100, converted_intake_id=<new>.
  3. `writeAuditLog('opportunity.won', 'opportunities', id, { opportunity_id, intake_id })`.
  4. `writeAuditLog('project_intake.created', 'project_intake', intake_id, { opportunity_id, source:'crm_win' })`.
- Return `{ intake_id, alreadyConverted: false }`.

Also add `getWinConversionPrefill({ opportunityId })` (GET) returning `{ opportunity: {...}, ownersList: profiles-in-company (id, email, full_name) }` for the dialog. Owners fetched from `profiles` filtered by `company_id`.

### Server: `src/lib/exports/kickoff-pdf.ts` (new)

`buildKickoffPack({ opportunityId, intakeId })` server fn:
- Gate through `assertExportAllowed(company_id, 'kickoff_pack')`; 42P01 → proceed.
- Gather: opportunity (full, incl. margin/estimated_value), contacts (`listContacts`), accepted proposal (latest proposals row for opportunity where status in ('accepted','sent') ordered by version desc, else latest), yield_result (P50/P90/monthly), tender_events history.
- Build PDF with jspdf + autoTable — reuse branding fetch pattern from `src/lib/exports/proposal-pdf.ts` (`company_branding` + logo signed URL). Sections: cover, opportunity summary + **margin snapshot (internal — margin included, unlike client PDF)**, contacts table, accepted proposal pricing (version, subtotal, contingency_pct, total, currency), yield P50/P90 tiles + monthly table, tender events history table, next-steps checklist (`[ ] Assign project_admin`, `[ ] Run project wizard (Batch 04)`, `[ ] Schedule kickoff meeting`). Watermark footer: "Internal — do not distribute".
- Upload via service-role Supabase client to `documents` bucket at `<company_id>/intake/<intake_id>/kickoff_pack.pdf` (upsert).
- Append kickoff path to opportunity notes (append-only note line "Kickoff pack: <path>"); `writeAuditLog('opportunity.kickoff_pack_generated', 'opportunities', opp.id, { intake_id, path })`.
- Return `{ path }`. Called from the client immediately after `convertOpportunityToIntake` resolves.

### Client: `src/components/crm/detail/WinConversionDialog.tsx` (new)

- Trigger: "Mark as won" button on `OpportunityHeaderCard` (or detail header). Hidden when `stage='won'` (already-won branch shows an inline banner instead).
- Dialog form (react-hook-form + zod): name (default opp.name), archetype (Select, 7 canonical values, default opp.archetype), capacity_mw (default), offtaker (default account_name), target_cod (date), owner (Select loaded from `getWinConversionPrefill`).
- Submit: call `convertOpportunityToIntake` → on success, call `buildKickoffPack` (fire-and-forget with toast progress; failures show toast but don't roll back the win). Invalidate queries: `["crm","opportunity",id]`, `["crm","pipeline"]`, `["crm","kpis"]`, `["crm","activity",id]`. Sonner success toast with `<Link to="...">View intake</Link>` (route: intake list not yet in Batch 06 — link to opportunity banner href `/projects` or the intake id; use anchor showing intake id — clarify in Technical section).

### Client: won-state banner

- In `OpportunityHeaderCard` (or detail route body), when `opp.stage === 'won'` and `opp.converted_intake_id`: render banner "Won — converted to project intake #<shortId>" with a "Download kick-off pack" button that calls a new `getKickoffPackDownloadUrl({ intakeId })` server fn (signed URL from `documents` bucket, RLS-scoped). Re-clicking "Mark as won" is disabled; button hidden.

### Idempotency & KPIs

- `convertOpportunityToIntake` short-circuits when `converted_intake_id` already exists → guarantees single intake row.
- CRM KPI strip already queries pipeline; won stage move causes stage='won' rollup on next load. No KPI code change needed.

### Verification

1. Typecheck.
2. Mark test opportunity won → verify project_intake row, opportunity fields, audit rows via `supabase--read_query`.
3. Second click → dialog not shown, banner + download visible; no duplicate intake.
4. Lost opportunity → server rejects with clear error.
5. Storage: object at `<company>/intake/<id>/kickoff_pack.pdf`.

### Technical notes

- `project_intake_source` enum has no `crm_win` value (only `manual|opportunity|api|other`). Use `'opportunity'` and record `source:'crm_win'` in the audit metadata for provenance; no schema change.
- No true cross-table transaction is available from PostgREST. Order operations so intake insert (the only creation) happens first; if the opportunity update fails, best-effort delete the intake row and surface the error.
- Kick-off pack generation runs post-conversion so a PDF failure never blocks the win. Failure surfaces a retry toast; a "Regenerate kick-off pack" button on the banner reuses `buildKickoffPack`.
- Server functions live in `src/lib/opportunity.functions.ts` (no new server-only sibling helpers — new PDF builder is a `.server.ts`-safe pure module imported into the fn).