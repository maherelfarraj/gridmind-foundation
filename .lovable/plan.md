# P-061 — Vendors & Vendor Scorecards

## 1. Migration `supabase/migrations/0024_vendors.sql`

- Guarded `do $$ ... $$` block creating `vendor_status` enum (`onboarding|active|suspended|blacklisted`).
- `public.vendors` and `public.vendor_scorecards` tables per spec (tenancy columns, FKs, defaults, unique constraint on scorecards).
- Enable RLS on both; policies:
  - SELECT: `is_company_member(company_id)`
  - Write (ALL): member + role in (`procurement_admin`, `procurement_officer`, `company_admin`).
- GRANTs to `authenticated` as specified; add `GRANT ALL ... TO service_role` for both.
- Indexes `vendors_company_idx`, `scorecards_vendor_idx`.
- Attach existing `public.set_updated_at()` BEFORE UPDATE triggers to both tables.

## 2. Server layer — `src/lib/vendors.functions.ts`

All `createServerFn` + `requireSupabaseAuth` + zod input validators; each mutation writes `write_audit_log` via RPC.

- `listVendors({ search?, status? })` — RLS-scoped select ordered by `created_at desc`.
- `getVendor({ id })`.
- `createVendor(input)` — inserts, sets `created_by`, audit `vendor.create`.
- `updateVendor({ id, patch })` — audit `vendor.update`.
- `changeVendorStatus({ id, status })` — updates `status`, stamps `onboarded_at` when transitioning to `active`, audit `vendor.status_change` with `{from,to}`.
- `uploadVendorCertification({ vendorId, fileName, mimeType, base64, name, issuer, expiresAt })` — server uploads to `documents` bucket at `{company_id}/vendor-certs/{vendor_id}/{uuid}-{fileName}` using the request-scoped supabase client, appends `{name,issuer,expires_at,file_path}` to `certifications` jsonb. Audit `vendor.update` with `{certification_added: name}`.
- `deleteVendorCertification({ vendorId, filePath })` — removes storage object + jsonb entry.

Zod schemas colocated in `src/lib/vendors.schema.ts` (payment terms enum `net_15|net_30|net_45|net_60`, incoterms free text w/ common defaults, categories string array, currency code required).

## 3. TanStack Query wrappers — `src/lib/vendors-query.ts`

`vendorsQueryOptions`, `vendorQueryOptions(id)`, mutation hooks with optimistic updates and sonner toasts.

## 4. UI Routes

Under `src/routes/_authenticated/procurement.vendors.*`:

- `procurement.vendors.tsx` — layout `<Outlet />` + shared header/nav.
- `procurement.vendors.index.tsx` — data table: search input, status filter dropdown, "New vendor" button, skeleton (Skeleton rows), empty state (`No vendors yet — onboard your first vendor`), error state with retry (calls `router.invalidate()` + `reset()`), CSV export (client-side from loaded rows: name, status, categories, payment_terms, incoterms, currency, city, country, created_at).
- `procurement.vendors.new.tsx` — onboarding form (react-hook-form + zod resolver). On success navigate to `$vendorId`.
- `procurement.vendors.$vendorId.tsx` — edit form + status controls + certifications section.

Form fields:
- Identity: `name*`, `legal_name`, `tax_id`, `website`, `email`, `phone`, `address_line`, `city`, `country`.
- Commercial: `currency_code` (Select from `currencies`), `payment_terms` (Select), `incoterms` (Select w/ common: DAP, DDP, FOB, CIF, EXW), `categories` (multi-select chip input).
- Certifications uploader: file input + name/issuer/expiry; posts to `uploadVendorCertification`. Displays list with download link (signed URL) and remove button.
- Status control (edit page only): dropdown restricted to allowed transitions, gated by role.

All UI uses semantic tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`, badges via `variant`). Zero raw hex.

## 5. Navigation

Add "Vendors" entry under the Procurement section of the AppShell sidebar (visible to `procurement_admin`, `procurement_officer`, `company_admin`, `project_admin`).

## 6. Verification

- `supabase--migration` runs migration; then re-run once via `supabase--read_query` `select 1` sanity and confirm `pg_policies` count = 2 per table.
- Cross-tenant check: `select count(*) from vendors where company_id <> <current>` under RLS via a test server fn → 0.
- Seed two vendors (JinkoSolar, Sundrive Modules… actually pick tier-1: **JinkoSolar Co., Ltd.** and **Sungrow Power Supply Co., Ltd.**) through the UI during manual QA; upload a small ISO 9001 PDF; verify jsonb entry and storage path prefix `{company_uuid}/vendor-certs/...`.
- Audit log rows for `vendor.create` and `vendor.status_change` verified via `supabase--read_query`.
- Manual role check: sign in as sales/engineer → list works, write returns 403 (toast surfaces error).

## Technical notes

- Storage: reuse existing `documents` bucket + `storage_company_id()` RLS. First path segment MUST be `company_id` UUID.
- Upload strategy: send file as base64 over server fn (kept small; certs typically <5MB). If files could be large, switch to signed upload URL later — out of scope now.
- Audit calls use existing `write_audit_log(action, entity, entity_id, metadata)` RPC via `context.supabase.rpc(...)`.
- No changes to any auto-generated files.
