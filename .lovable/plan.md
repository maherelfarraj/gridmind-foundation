## P-043 — Opportunity Detail

Route `/crm/opportunities/$opportunityId` with header, contacts, competitor intel, tender events, and audit-driven activity timeline.

### Route + loader
- `src/routes/_authenticated/crm.opportunities.$opportunityId.tsx`
- Loader: `context.queryClient.ensureQueryData(opportunityDetailQueryOptions(id))`
- Loader fetches opportunity via `getOpportunity(id)` server fn; throws `notFound()` if RLS returns 0 rows
- `notFoundComponent`: branded "Opportunity not found" card (design tokens)
- `errorComponent`: branded error card with `router.invalidate() + reset()` retry
- Also add nav wire-up: opportunity cards on pipeline board link here

### Server functions — `src/lib/opportunity.functions.ts` (new)
All `.middleware([requireSupabaseAuth])`, zod validation, `writeAuditLog` with `metadata.opportunity_id`.
- `getOpportunity({id})` → opportunity + owner profile (full_name)
- `updateOpportunity({id, patch})` — name, account, capacity_mw, estimated_value, currency_code, expected_decision_date, competitor, loss_reason, notes; audit `opportunity.updated`. Stage changes still go through existing `moveOpportunityStage` (reused).
- `listContacts({opportunityId})`, `saveContact({id?, opportunityId, full_name, title?, email?, phone?, is_primary, notes?})` — when `is_primary=true`, single SQL update demotes siblings for that opportunity_id before insert/update; audit `contact.saved`.
- `deleteContact({id})` — company_admin only (server-side role check via `has_role`); audit `contact.deleted`.
- `listTenderEvents({opportunityId})`, `saveTenderEvent({id?, opportunityId, event_type, title, event_at, location?, notes?})`; audit `tender_event.saved`.
- `deleteTenderEvent({id})` — company_admin only; audit `tender_event.deleted`.
- `postOpportunityNote({opportunityId, body})` — body 1..2000, writes `writeAuditLog('opportunity.note','opportunity', id, {opportunity_id, body})` only (no separate table).
- `getOpportunityActivity({opportunityId})` — returns unified `ActivityItem[]` sorted desc, merging:
  - `audit_logs` where `entity='opportunity' AND entity_id=:id` OR `metadata->>'opportunity_id' = :id`, joined to `profiles` for actor `full_name`
  - `tender_events` for this opportunity (type: `tender_event`)
  - `proposals` if table exists; wrap query in try/catch on Postgres `42P01` (proposals may not exist until P-044) — treat as empty
  - Each item: `{ id, kind, at, actor?, label, meta }` where `kind ∈ 'audit'|'tender'|'proposal'`

### Query layer — `src/lib/opportunity-query.ts` (new)
- `opportunityDetailQueryOptions(id)`, `contactsQueryOptions(id)`, `tenderEventsQueryOptions(id)`, `activityQueryOptions(id)`
- Mutation hooks invalidate the relevant key + `activity` (so timeline refreshes in one turn)
- Optimistic UI on save-contact / save-tender-event / stage change / decision-date change

### Components — `src/components/crm/detail/`
- `OpportunityHeaderCard.tsx` — name (inline edit), account, archetype badge, capacity MW, stage `<Select>` (probability shown next to it, updates via `moveOpportunityStage`; loss dialog reused when → lost), est. value (Intl.NumberFormat + currency_code, inline edit), decision date (shadcn DatePicker with `pointer-events-auto`, date-fns `format`), owner. Actions: "New proposal" (nav placeholder → `/crm/opportunities/$id/proposals/new`, disabled until P-044 with tooltip), "Mark as won" (calls moveOpportunityStage→won), "Add tender event" (opens tender dialog).
- `ContactsCard.tsx` + `ContactDialog.tsx` — table rows with primary star; add/edit dialogs; delete only rendered for company_admin; empty state.
- `CompetitorIntelCard.tsx` — inline-edit `competitor`, `loss_reason` (only shown when `stage='lost'`), `notes` textareas; single "Save" per card.
- `TenderEventsCard.tsx` + `TenderEventDialog.tsx` — sorted chronologically, lucide icon per type, countdown badge (`formatDistanceToNow`) for future, `text-destructive` for past events without `reminder_sent_at`; datetime picker (DatePicker + time input).
- `ActivityTimeline.tsx` — vertical timeline, actor avatar/name, relative time, per-kind label & icon; skeleton + empty state; sticky note composer at top (textarea + "Post note" button).

### Permissions
- `canWrite = roles ∈ {sales, company_admin}`; finance_admin renders read-only (no dialogs, buttons hidden). Reuse existing role source used on pipeline route.
- Delete actions gated to `company_admin` in both UI and server fn.

### Verification (post-build)
- Playwright: open the seeded "Aqaba Solar+BESS", add contact + set primary (verify sibling demote in DB), add tender event dated +7 days (countdown badge), post note, change stage — confirm all four appear in timeline
- DB: `SELECT action FROM audit_logs WHERE metadata->>'opportunity_id'=...` shows contact.saved, tender_event.saved, opportunity.note, opportunity.stage_changed
- Screenshot overdue tender event in destructive color
- Cross-company UUID → branded not-found

No migrations. No schema changes.
