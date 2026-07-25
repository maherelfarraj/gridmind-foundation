# Operator Environment Variables

GridMind EPC runs on Lovable Cloud. The Supabase pair is injected automatically at build and runtime; operator-supplied secrets go through the Lovable Cloud secret store — **never** a committed `.env`. The repo's `.env.example` (if present) carries variable names with empty values only.

## Golden rules

- Secrets live only in the Lovable Cloud secret store. Never in git, never printed to logs, never returned to the client.
- Browser code reads only `import.meta.env.VITE_*`. Server code reads only `process.env.*`. Never rename a server secret to a `VITE_`-prefixed variable — that ships it in the client bundle.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is confined to **guarded** webhook/cron handlers (via `createServiceRoleClient()` in `src/integrations/supabase/admin.ts`). Never use it for ordinary reads.
- The public-hook guard trusts **only `cf-connecting-ip`** for the client IP. `x-forwarded-for` is client-spoofable and is never read anywhere in the codebase — do not "helpfully" add it.
- Rotation: platform-managed keys rotate through Lovable Cloud. Operator-supplied secrets rotate by updating the Cloud secret store; redeploy to pick up new values. `PUBLIC_HOOK_SIGNING_SECRET` supports a dual-verify overlap during rotation (see runbook).

## Variables

| Variable | Used by | Required | Source | Notes / rotation |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | yes | Lovable Cloud env (auto-injected) | Public. Safe in shipped JS. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser | yes | Lovable Cloud env (auto-injected) | Public / anon key. RLS still applies. |
| `VITE_SUPABASE_PROJECT_ID` | Browser | yes | Lovable Cloud env (auto-injected) | Public project ref. |
| `SUPABASE_URL` | All server code | yes | Lovable Cloud env | Mirror of the VITE value for Worker/SSR. |
| `SUPABASE_PUBLISHABLE_KEY` | Server (user-scoped clients) | yes | Lovable Cloud env | RLS evaluated as the user via bearer token. |
| `SUPABASE_ANON_KEY` | Cron `apikey` header auth (P-123) | yes | Lovable Cloud env | pg_cron sends this as the `apikey` header so the guard recognises `caller.kind === 'cron'`. Rotates with the Supabase key rotation. |
| `SUPABASE_SERVICE_ROLE_KEY` | Guarded hook/cron handlers ONLY | yes | Lovable Cloud secret store (managed) | Bypasses RLS. Never client-exposed, never for ordinary reads. Rotates with the Supabase key rotation. |
| `SUPABASE_DB_URL` | Server migrations/maintenance | yes | Lovable Cloud secret store (managed) | Direct Postgres. Do not use from app code. |
| `LOVABLE_API_KEY` | Lovable AI Gateway features | optional | Managed (auto-provisioned) | Do not set manually. Rotate via the Lovable AI Gateway tool, not the secrets tool. |
| `PUBLIC_HOOK_SIGNING_SECRET` | HMAC stage of `guardPublicHook` (P-121) | recommended | Lovable Cloud secret store | ≥ 32 random bytes. Rotation: set the new value on a secondary key `PUBLIC_HOOK_SIGNING_SECRET_NEXT`, deploy, wait one full replay window (≥ 300 s), promote NEXT → primary, remove NEXT. This lets integrators cut over without a blackout. |
| `PUBLIC_HOOK_ENFORCE` | Guard failure mode | no (default `block`) | Lovable Cloud env | `warn` \| `block`. Auth and rate-limit failures **always** block; only IP allowlist and HMAC verification honour warn/block. See runbook. |
| `PUBLIC_HOOK_IP_ALLOWLIST` | Guard IP stage | optional | Lovable Cloud env | CSV of IPv4 addresses or CIDR blocks. Source IP is **`cf-connecting-ip` only** — `x-forwarded-for` is never read. A single malformed entry fails the guard **closed** (deny), never open. |
| `CRON_APIKEY` | Cron `apikey` header (alternative to `SUPABASE_ANON_KEY`) | optional | Lovable Cloud secret store | Only set if you want a dedicated cron trigger secret separate from the Supabase anon key. |
| `ESIGN_PROVIDER` | E-signature adapter (P-049 / P-126) | optional | Lovable Cloud env | `manual` (dev) \| `docusign`. Missing → `manual`. |
| `ESIGN_API_KEY` | E-signature outbound (P-049) | optional | Lovable Cloud secret store | Provider API key. Not required in `manual` mode. |
| `ESIGN_WEBHOOK_SECRET` | E-signature inbound webhook (P-126) | optional | Lovable Cloud secret store | HMAC secret used to verify `x-esign-signature`. Rotation: same dual-verify pattern as `PUBLIC_HOOK_SIGNING_SECRET` if your provider supports it, otherwise coordinate a maintenance window with the provider. |
| `CALENDAR_WEBHOOK_SECRET` | Calendar push webhook (P-126) | optional | Lovable Cloud secret store | Channel token compared with `x-goog-channel-token` (timing-safe). Rotate by re-registering the push channel with the new token. |
| `EMAILJS_SERVICE_ID` | `sendScheduledReport` (P-117) | optional | Lovable Cloud secret store | Required for scheduled report delivery; missing → `emailjs_not_configured`. |
| `EMAILJS_TEMPLATE_ID` | `sendScheduledReport` (P-117) | optional | Lovable Cloud secret store | Template params: `to_email`, `report_name`, `period`, `attachment_base64`, `company_name`. |
| `EMAILJS_PUBLIC_KEY` | `sendScheduledReport` (P-117) | optional | Lovable Cloud secret store | EmailJS public (user) key. |
| `EMAILJS_PRIVATE_KEY` | `sendScheduledReport` (P-117) | optional | Lovable Cloud secret store | EmailJS private key for REST auth. |

## Client selection cheat sheet

| Caller | Use | RLS |
| --- | --- | --- |
| React components, browser hooks, realtime | `import { supabase } from '@/integrations/supabase/client'` | As user |
| `createServerFn` RPC handler | `.middleware([requireSupabaseAuth])`, then `context.supabase` | As user |
| Raw HTTP route needing user scope | `createServerSupabaseClient(request)` | As user |
| Guarded webhook/cron handler after verifying the caller | `createServiceRoleClient()` from `@/integrations/supabase/admin` | Bypassed |

## Local / preview environments

Lovable Cloud injects every `SUPABASE_*` and `VITE_SUPABASE_*` value for both preview and published deployments. Operators do not hand-copy them. Operator-supplied secrets (`PUBLIC_HOOK_*`, `ESIGN_*`, `CALENDAR_WEBHOOK_SECRET`, `EMAILJS_*`) must be set explicitly in each environment where the feature is enabled.

---

## Production promotion runbook — `warn` → watch → `block`

The public-hook guard (P-121) ships with `PUBLIC_HOOK_ENFORCE=warn` in staging so integrators can be onboarded without traffic being blocked while they finish their signer implementation. Promote to `block` only after the watch window is clean.

### 1. Deploy in `warn`

- `PUBLIC_HOOK_ENFORCE=warn` (or unset — default is `block` in code, but keep it explicit as `warn` during onboarding).
- Pre-populate `PUBLIC_HOOK_IP_ALLOWLIST` with every known integrator's egress IPs / CIDRs. A single malformed entry fails **closed**; verify the CSV parses.
- Confirm `PUBLIC_HOOK_SIGNING_SECRET` is set and ≥ 32 bytes.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is present (guarded handlers need it).

### 2. Watch ≥ 7 days

Run this query daily. Every row is an integrator to fix **before** flipping to block:

```sql
select
  action,
  metadata->>'endpoint' as endpoint,
  count(*) as hits
from audit_logs
where action in (
  'public_hook.ip_denied',
  'public_hook.signature_failed',
  'public_hook.rate_limited'
)
  and created_at > now() - interval '7 days'
group by 1, 2
order by hits desc;
```

Also grep server logs for:

- `rate_limit_fail_open` — the rate-limit RPC errored and the guard let the request through. Investigate the RPC, not the caller.
- `guard_audit_failed` — the guard could not write its audit row. Investigate the audit pipeline.

For every `public_hook.ip_denied` / `public_hook.signature_failed` row, contact the integrator and verify their signer against `docs/public-api-signing.md`. Common cause: they re-serialize the body after signing (pretty-print JSON) — the signature covers different bytes than the ones sent.

### 3. Verify rate-limit health

```sql
select endpoint, key_id, tokens, updated_at
from rate_limit_buckets
order by updated_at desc
limit 50;
```

You should see the expected per-endpoint keys and no pathological caller monopolising a bucket.

### 4. Flip to `block`

- Set `PUBLIC_HOOK_ENFORCE=block`.
- Redeploy.
- Monitor 401/403 rates and `audit_logs` for 48 h.
- **Rollback** is a config change only — revert `PUBLIC_HOOK_ENFORCE` to `warn` and redeploy. No code change required.

### 5. Record the promotion

Write a manual `audit_logs` row (or run it via a maintenance server function) capturing:

- Promotion date (UTC).
- Approver (email + user id).
- Snapshot of `PUBLIC_HOOK_IP_ALLOWLIST` at time of promotion.

Schedule a **quarterly** review of the allowlist and active API keys — revoke unused keys, prune stale IPs, rotate `PUBLIC_HOOK_SIGNING_SECRET` and `ESIGN_WEBHOOK_SECRET`.

### 6. Pre-flight checklist

- [ ] All required secrets present (`SUPABASE_*`, `PUBLIC_HOOK_SIGNING_SECRET`, integrator-specific `ESIGN_*` / `CALENDAR_WEBHOOK_SECRET` / `EMAILJS_*` where applicable).
- [ ] `PUBLIC_HOOK_IP_ALLOWLIST` CSV parses (test locally: guard rejects the whole list closed if any entry is malformed).
- [ ] pg_cron schedules registered (`escalations */5 * * * *`, `pm-work-orders` `*/15 * * * *`, `scheduled-reports` `*/15 * * * *`, `audit-retention` `17 3 * * *`, `webhook-dispatch` `*/5 * * * *`).
- [ ] Latest migrations applied.
- [ ] `webhook_endpoint_secrets` and `api_keys.key_hash` unreachable from the `authenticated` role (RLS spot-check).
- [ ] **Signed `/api/public/hooks/ping` smoke test returns 200 `{ pong: true }`** — copy the exact curl from `docs/public-api-signing.md`, run against production, expect `pong`. This is the last gate before promotion.
