## P-108 — Warranty contracts & claims tracking

### Migration `supabase/migrations/…_warranty_sla.sql`
- Enums via guarded do-blocks: `warranty_type`, `warranty_claim_status`.
- Tables per spec:
  - `warranty_contracts` (fk → projects, equipment_registry, vendors; document_path text).
  - `warranty_claims` (fk → warranty_contracts, currencies; unique `(company_id, claim_number)`; attachments jsonb).
- GRANT authenticated + service_role; RLS enabled; policies per spec (`is_company_member` SELECT; `om_admin`/`company_admin` writes).
- Indexes: warranty_equipment_idx, warranty_company_expiry_idx, claims_warranty_idx.
- Attach existing `public.set_updated_at()` trigger to both tables.

### Server layer
- `src/lib/warranties.rules.ts` — zod schemas + enums:
  - `warrantyContractUpsertSchema`, `warrantyClaimCreateSchema` (`override_note` optional), `claimSubmitSchema`, `claimStatusSchema` (approve/reject with note), `claimSettleSchema` (settled_amount + currency).
  - Helper `daysRemaining(endDateISO)` and `warrantyStatusBadge(days)` returning `active|expiring|expired`.
- `src/lib/warranties.server.ts` — pure helpers:
  - `generateClaimNumber(client, companyId)` → `WC-YYYY-NNNN` derived from max per company (matches wo_number pattern), retry once on 23505.
  - `assertWarrantyClaimable(warranty, isOmAdmin, overrideNote)` — throws when `today > end_date` unless om_admin + non-empty note.
- `src/lib/warranties.functions.ts` — createServerFn with `attachSupabaseAuth`:
  - `listWarranties({ project_id?, expiring_within_days?, q? })` joined to equipment/vendor.
  - `getWarranty({ id })` with claims.
  - `upsertWarranty` (write role), `deleteWarranty`.
  - `listClaims({ warranty_id })`, `createClaim` (calls assertWarrantyClaimable; role check om_admin for override), `submitClaim`, `advanceClaimStatus` (draft→submitted→under_review→approved/rejected), `settleClaim` (records settled_amount + resolved_at; only from approved).
  - `getWarrantyKpis({ project_id? })` — active coverage % = distinct active equipment with a non-expired warranty ÷ active equipment count.
  - `uploadWarrantyDoc` returns signed upload path at `{company_id}/warranties/{warranty_id}/…` in `documents` bucket (uses existing storage helper pattern used by other modules).
  - Every mutation calls `write_audit_log` with actions: `warranty.create|update|delete`, `claim.create|submit|status|settle`.

### UI `src/routes/_authenticated/om.warranties.tsx`
- Header: page title, "New warranty" action, KPI tile "Active coverage %" from `getWarrantyKpis`, secondary tiles (contracts, expiring <90d, open claims).
- Filters row: text search, expiring-soon toggle, project select, warranty type select.
- Registry Table with columns: Equipment tag, Vendor, Type (badge), Start–End, Days remaining chip (active green / expiring amber / expired muted using semantic tokens `bg-success/…`, `bg-warning/…`, `bg-muted/…`), Claims count, Actions.
- Skeleton / empty / error states, CSV export button ("Export CSV").
- Row click opens a detail Drawer with tabs:
  - **Details** — read-only summary + Edit (dialog reuses upsert form).
  - **Coverage** — coverage notes editor (write-role gated).
  - **Document** — upload/replace warranty PDF via signed upload to `documents/{company_id}/warranties/{warranty_id}/`; show current file with download link.
  - **Claims** — list existing claims + "New claim" (blocked if expired unless om_admin toggles "Override with note" and provides text ≥3 chars). Per-claim inline actions to submit → mark under_review → approve/reject (with note) → settle (amount + currency).

### Components
- `src/components/warranties/warranty-dialog.tsx` — react-hook-form + zod upsert (project → equipment → vendor cascading selects; type; start/end date; terms/coverage notes).
- `src/components/warranties/warranty-drawer.tsx` — Tabs + doc upload + claims panel.
- `src/components/warranties/claim-dialog.tsx` — create/submit/settle sub-forms with server-side status guards mirrored client-side.

### Nav
- Append to `src/lib/nav-map.ts` under the O&M section: `Warranties → /om/warranties` (icon: `ShieldCheck` from lucide-react).

### Tests
- `tests/unit/warranties.test.ts` — pure logic:
  - `daysRemaining` / `warrantyStatusBadge` boundaries (0, 89, 90, negative).
  - `assertWarrantyClaimable` (active passes; expired throws; expired + om_admin + note passes; expired + om_admin without note throws).
  - Claim number format regex `^WC-\d{4}-\d{4}$`.
  - Zod schemas: reject missing settled_amount when settling; require override_note when overriding expired.
- `tests/rls/warranties.rls.test.ts` — stub asserting cross-company isolation and role gating shape (skipped if no service creds, mirroring existing RLS stubs).

### Verification checklist mapping
1. Register warranty for INV-01-01 (manufacturer, 5y) → active green; another ending in 60d → amber → covered by `warrantyStatusBadge` + row rendering.
2. Claim against expired warranty blocked without override → `assertWarrantyClaimable` server-side error `expired_warranty_no_override`.
3. Full claim lifecycle (create → submit → approve → settle with amount + resolved_at) exercised by drawer actions.
4. Active coverage % from real data via `getWarrantyKpis` (distinct equipment_id with `end_date >= today`).
5. Doc upload path enforced to `{company}/warranties/…`; every mutation writes audit log.

### Constraints honored
- Only design tokens (no raw hex/rgb).
- "O&M" spelled correctly in all copy.
- `createServerFn` + `zod` + `requireSupabaseAuth` for all mutations.
- Depends on P-101 (equipment_registry) and P-061 (vendors), both present.

Next after green: P-109 (service tickets + SLA timers + breach log).