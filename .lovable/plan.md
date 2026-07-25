## P-115 — Investor share links

Tokenized, expiring, scope-limited public read views for investor/lender audiences, with admin revoke UI.

### 1. Migration `0055_investor_share_links.sql`

- Create `public.investor_share_links` per the spec (label, token_hash unique, role check `investor_viewer|lender_viewer`, scope jsonb, expires_at, revoked_at/by, last_accessed_at, access_count, created_by, timestamps).
- Enable RLS; single `share_links_admin` policy (company_admin only). Grant SELECT/INSERT/UPDATE to `authenticated`, plus `GRANT ALL ... TO service_role`. No `anon` grants.
- Attach `set_updated_at` trigger; index on `(company_id, expires_at)`.
- `resolve_share_link(p_token_hash text) RETURNS jsonb`, SECURITY DEFINER, `search_path=public`:
  - Look up by `token_hash`; if not found → `{ok:false, reason:'invalid'}`.
  - If `revoked_at is not null` → `{ok:false, reason:'revoked'}`.
  - If `expires_at <= now()` → `{ok:false, reason:'expired'}`.
  - Otherwise: `UPDATE ... SET access_count = access_count+1, last_accessed_at=now()`.
  - For each scoped project_id, insert one `portal_audit_events` row (`event='share_link.viewed'`, actor_id=null, metadata: link id, role, sections).
  - Build curated payload:
    - `company`: id, name, plus branding (logo_url, primary_color, accent_color, footer_text).
    - `projects`: only rows in `scope.project_ids` — id, name, phase.
    - `milestones` (if `'milestones' ∈ sections`): `project_phase_gates` rows for scoped projects — phase, status, planned_date, actual_date, notes.
    - `photos` (if `'photos' ∈ sections`): `site_photos` rows — id, project_id, storage_path, caption, taken_at.
    - `kpis` (if `'kpis' ∈ sections`): latest `evm_snapshots` per project — as_of_date, spi, cpi, pv, ev, ac, eac.
    - `financials` (if `'financials' ∈ sections` AND `role='lender_viewer'`): latest `cash_flows` summary per project (revenue, opex, debt_service if present) — otherwise omit key entirely.
  - `REVOKE ALL ... FROM public; GRANT EXECUTE ... TO anon, authenticated`.

### 2. Server functions — `src/lib/share-links.functions.ts`

- `listShareLinks()` — admin only; returns rows for caller's company with derived status (`active|expired|revoked`).
- `createShareLink({ label, role, projectIds, sections, expiresPreset: '7d'|'30d'|'90d' })`:
  - `requireSupabaseAuth` + assert `company_admin`.
  - Validate all `projectIds` belong to caller's company.
  - Generate 32 random bytes → hex token (server-side, `crypto.randomBytes`).
  - SHA-256 hex → store as `token_hash`.
  - Insert row with resolved `expires_at`; write `audit_logs` (`share_link.created`).
  - Return `{ id, token, url }`. Token is shown once only.
- `revokeShareLink({ id })` — set `revoked_at=now(), revoked_by=uid`; write `share_link.revoked` audit.
- `resolveShareLink({ tokenHash })` — public server function, no auth middleware. Calls the `resolve_share_link` RPC via a server publishable Supabase client so RLS/GRANTs match anon. Applies `consume_rate_limit('share:'+ip, 30, 0.5)` (fail-open on error); reads client IP from request headers (`x-forwarded-for` fallback `unknown`). Returns whatever the RPC returns.

### 3. Public route `src/routes/share.$token.tsx`

- Top-level route, OUTSIDE `_authenticated`.
- `loader`: hash token with WebCrypto SHA-256 → call `resolveShareLink`. Set response headers `Cache-Control: no-store` via `setResponseHeader`.
- `head`: `noindex`, generic title; no data leakage.
- Component renders:
  - Branded minimal shell using company branding (logo, footer_text) — semantic tokens only.
  - Distinct branded panels for `invalid`, `revoked`, `expired` (no data, same layout).
  - On success: project cards; KPI tiles (SPI/CPI/EV/EAC formatted); milestone list (spelled "O&M"/"C&I" correctly if surfaced); lazy-loaded photo grid using existing public storage read pattern (signed URL through a small anon-callable `share_photo_url` server fn keyed by token_hash + path membership check — or, simpler: return signed URLs from `resolveShareLink` itself for photos in scope, using `supabaseAdmin` inside `resolveShareLink` to sign for the anon caller). Plan uses the latter (sign inside `resolveShareLink`).
- No links to any authenticated area.

### 4. Admin UI `src/routes/_authenticated/settings.share-links.tsx`

- Guard visible to `company_admin`.
- Table columns: label, role, projects (count/name tooltips), sections (chips), created_by, expiry (countdown via `date-fns` `formatDistanceToNowStrict`), access_count, last_accessed, status badge.
- Skeleton loading, empty state ("No share links yet"), error retry.
- "Create link" dialog form (react-hook-form + zod):
  - Label (3–120), role select, project multi-select (from `listAdminProjects`), sections checkboxes (kpis, milestones, photos, financials), expiry preset (7/30/90 days).
  - Financials checkbox tooltip: "Only visible when role = Lender viewer".
- On success: one-time modal showing full `https://<origin>/share/<token>` with copy button, warning "This URL is shown once — save it now". No way to re-view later.
- Revoke button (destructive confirm) — invalidates the list; audit is server-side.

### 5. Tests / verification

- Bun typecheck.
- Manual QA against the checklist: incognito open, revoke behavior, expired behavior, out-of-scope project not returned, DB has only hash (64 hex), `Cache-Control: no-store`, audit rows recorded.

### Technical details

- The `resolve_share_link` RPC does its own audit inserts (so anon can log without table grants); admin actions use `write_audit_log` helper.
- Signed photo URLs generated inside the RPC caller (`resolveShareLink` server fn) via `supabaseAdmin.storage.from('photos').createSignedUrl(path, 900)` — RPC returns raw paths, server fn signs before returning to browser. This keeps the admin client server-side only and never exposes it to the public loader.
- IP for rate limiter derived from `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'`.
- Token: `randomBytes(32).toString('hex')` (64 hex chars); public route validates `/^[a-f0-9]{64}$/i` before hashing.
