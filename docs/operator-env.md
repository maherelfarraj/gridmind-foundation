# Operator Environment Variables

GridMind EPC runs on Lovable Cloud. The Supabase pair is injected automatically at build and runtime; operator-supplied secrets go through the Lovable Cloud secret store (never a committed `.env`).

## Golden rules

- Browser code reads only `import.meta.env.VITE_*`. Server code reads only `process.env.*`.
- Never rename a service-role or secret value to a `VITE_`-prefixed variable — that would ship it in the client bundle.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Only guarded webhook/cron handlers may use it, and only via `createServiceRoleClient()` in `src/integrations/supabase/server.ts`.
- Rotation: platform-managed keys rotate through Lovable Cloud. Operator-supplied secrets rotate by updating the Cloud secret store; redeploy to pick up new values.

## Variables

| Variable | Where set | Read by | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Lovable Cloud (auto-injected at build) | Browser | Supabase project URL for the browser client. | Public. Safe in shipped JS. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Lovable Cloud (auto-injected at build) | Browser | Publishable/anon key for the browser client. | Public. RLS still applies. |
| `VITE_SUPABASE_PROJECT_ID` | Lovable Cloud (auto-injected at build) | Browser | Project ref, used by generated integration files. | Public. |
| `SUPABASE_URL` | Lovable Cloud (auto-injected at runtime) | Server | Same project URL for Worker/SSR code. | Mirror of the VITE value. |
| `SUPABASE_PUBLISHABLE_KEY` | Lovable Cloud (auto-injected at runtime) | Server | Anon key used by per-request user-scoped clients (`createServerSupabaseClient`, `requireSupabaseAuth`). | RLS evaluated as the user via bearer token. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud (auto-injected at runtime, RESTRICTED) | Server (webhook/cron only) | Admin key used exclusively by `createServiceRoleClient()`. | BYPASSES RLS. Never log, never return, never expose to the browser. |
| `SUPABASE_DB_URL` | Lovable Cloud (auto-injected at runtime, RESTRICTED) | Server (migrations/maintenance) | Direct Postgres connection string. | Do not use from app code. |
| `LOVABLE_API_KEY` | Lovable Cloud (managed) | Server | Auth for the Lovable AI Gateway (chat, embeddings, TTS, STT, image gen). | Rotate via the Lovable AI Gateway tool, not the secrets tool. |
| `PUBLIC_HOOK_ENFORCE` | Lovable Cloud secret store (operator-supplied) | Server (`/api/public/*`) | Kill-switch flag for public webhook hardening. Values: `on` / `off`. | Wired in a later batch. |
| `PUBLIC_HOOK_IP_ALLOWLIST` | Lovable Cloud secret store (operator-supplied) | Server (`/api/public/*`) | Comma-separated CIDR/IP list allowed to hit public webhook routes. | Wired in a later batch. |
| `PUBLIC_HOOK_SIGNING_SECRET` | Lovable Cloud secret store (operator-supplied) | Server (`/api/public/*`) | HMAC signing secret for verifying inbound webhook payloads. | Wired in a later batch. |

## Client selection cheat sheet

| Caller | Use | RLS |
| --- | --- | --- |
| React components, browser hooks, realtime | `import { supabase } from '@/integrations/supabase/client'` | As user |
| `createServerFn` RPC handler | `.middleware([requireSupabaseAuth])`, then `context.supabase` | As user |
| Raw HTTP route in `src/routes/api/*` needing user scope | `createServerSupabaseClient(request)` | As user |
| Guarded webhook/cron handler after verifying the caller | `createServiceRoleClient()` | Bypassed |

## Local / preview environments

Lovable Cloud injects every `SUPABASE_*` and `VITE_SUPABASE_*` value for both preview and published deployments. Operators do not need to hand-copy them. Operator-supplied `PUBLIC_HOOK_*` values must be set in each environment where public webhooks are enabled.
