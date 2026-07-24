
# P-029 — Company settings + branding editor

Single page at `/settings/company` with two sections: Company details and Branding. All company members read; only `company_admin` writes. Mutations via `createServerFn` + zod + `requireSupabaseAuth`, audited with `writeAuditLog`.

## 1. Migration (additive)

Migration `0013_company_branding.sql`:

- `ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone text, ADD COLUMN IF NOT EXISTS address text;`
- `CREATE TABLE IF NOT EXISTS public.company_branding` with columns from the spec (`company_id` PK FK → companies ON DELETE CASCADE, `logo_url`, `primary_color` default `'#1e40af'`, `accent_color` default `'#0d9488'`, `footer_text`, `created_at`, `updated_at`).
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_branding TO authenticated; GRANT ALL ON public.company_branding TO service_role;`
- `ALTER TABLE public.company_branding ENABLE ROW LEVEL SECURITY;`
- Policies exactly as in prompt: `members read branding` (SELECT via `is_company_member`), `admins write branding` (ALL via `has_company_role('company_admin')`).
- `updated_at` trigger via existing `set_updated_at()`.

Post-migration verification query: confirm columns, policies, trigger exist.

## 2. Server functions — `src/lib/company.functions.ts`

All use `attachSupabaseAuth` + `requireSupabaseAuth`. Resolve caller's `company_id` from `profiles`; verify `has_company_role('company_admin')` for writes.

- `getCompanySettings()` → returns `{ company: {id, name, legal_name, contact_email, phone, address, plan_tier}, branding: {...} | null, logoSignedUrl: string | null }`. Generates 5-minute signed URL from `documents` bucket when `logo_url` set.
- `updateCompanyDetails({ legal_name, contact_email, phone, address })` — zod validated; diff old vs new; write `company.updated` audit with `{changed_fields}` metadata.
- `upsertCompanyBranding({ primary_color, accent_color, footer_text })` — hex color regex `/^#[0-9a-fA-F]{6}$/`; upsert; audit `branding.updated` with changed fields.
- `getLogoUploadTarget()` → returns `{ bucket: 'documents', path: '{company_id}/branding/logo' }` so the browser can upload directly using the user's session (storage RLS accepts because path prefix is company UUID and user is a member).
- `setCompanyLogo({ path })` — validates path starts with caller's `{company_id}/branding/`; upserts branding row with `logo_url = path`; audits `branding.logo_updated`.
- `removeCompanyLogo()` — deletes object from storage (server-side using per-request client, RLS admin-only DELETE satisfied by `company_admin`), sets `logo_url = null`, audits `branding.logo_removed`.

Client uploads via `supabase.storage.from('documents').upload('{company_id}/branding/logo', file, { upsert: true, contentType })` using the browser Supabase client — storage `INSERT` policy already gates on `is_company_member`. Then calls `setCompanyLogo` to persist and audit.

## 3. UI — `src/routes/_authenticated/settings.company.tsx`

Two `<Card>` sections in one route:

**Company details form** (react-hook-form + zod):
- Fields: Legal name, Contact email, Phone, Address (textarea).
- Save button disabled unless dirty; sonner toast on success; inline errors.
- Read-only for non-admins (inputs disabled + hint text).

**Branding editor**:
- Logo: current preview from signed URL, drag/drop or file input, max 2 MB, accept `image/*`, client-side size + type check, live preview before upload, Upload + Remove buttons.
- Primary color + Accent color: shadcn `<Input type="color">` alongside hex text input, synchronized via RHF.
- Footer text: textarea.
- Helper copy under section title: *"Branding is applied to proposal PDF/PPTX exports."*
- Save button audits `branding.updated`.

**States**: skeleton cards while loading; sonner toast on save; inline zod errors; error `<Card>` with Retry button on fetch failure. Uses semantic tokens only (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`). Color hex values live in DB only — never render brand colors as component styling.

## 4. Navigation

Add "Company" entry under Settings in `src/lib/nav-map.ts` (visible to all authenticated members). `AppSidebar` picks it up automatically.

## 5. Verification (post-build, live as demo-admin via Playwright)

- Save details → row updated, `company.updated` audit row with `changed_fields`.
- Upload logo → object present at `documents/{company-uuid}/branding/logo`, `logo_url` persisted, preview renders via signed URL, survives reload.
- Colors + footer persist in `company_branding`; `branding.updated` audit written.
- RLS check: query as non-admin member — SELECT works, UPDATE denied.
- Negative storage test: attempt upload to `other-uuid/branding/logo` → 403 from storage RLS.

Then say `next` for P-030.
