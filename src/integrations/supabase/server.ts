/**
 * Per-request Supabase clients for raw HTTP routes under `src/routes/api/*`
 * (webhooks, cron callbacks, public APIs).
 *
 * Server functions created with `createServerFn` must keep using
 * `requireSupabaseAuth` from `./auth-middleware` — that is the canonical
 * user-scoped path and this file does not replace it.
 *
 * NEVER use the service-role key for ordinary reads. It bypasses RLS and
 * must only appear inside guarded webhook/cron handlers that have already
 * verified the caller (signature, shared secret, IP allow-list, etc.).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

/**
 * Opaque `sb_publishable_*` / `sb_secret_*` keys are not JWTs. PostgREST
 * rejects them when sent as `Authorization: Bearer <key>`. The shim strips
 * that header when it duplicates the apikey, and always sets `apikey`.
 * A caller-supplied `Authorization: Bearer <user-jwt>` is preserved so RLS
 * evaluates as the end user.
 */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get('Authorization') === `Bearer ${supabaseKey}`
    ) {
      headers.delete('Authorization');
    }
    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function readEnv(name: string): string | undefined {
  // Server-only: `process.env` is populated by the Worker runtime (see src/server.ts Env).
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(
      `[Supabase server] Missing required environment variable: ${name}. ` +
        `See docs/operator-env.md.`,
    );
  }
  return value;
}

const SUPABASE_AUTH_COOKIE_RE = /(?:^|;\s*)sb-[^=]*-auth-token=([^;]+)/;

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim() || null;
  }
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const match = SUPABASE_AUTH_COOKIE_RE.exec(cookie);
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match[1]);
    // Supabase cookies can be JSON `{ access_token, ... }` or a raw JWT.
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { access_token?: string };
      return parsed.access_token ?? null;
    }
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Fresh, per-request Supabase client scoped to the calling user. RLS
 * evaluates as that user. Never cache the returned client across requests.
 *
 * Intended for raw HTTP handlers in `src/routes/api/*`. For
 * `createServerFn` RPCs, use `requireSupabaseAuth` instead.
 */
export function createServerSupabaseClient(request: Request): SupabaseClient<Database> {
  const url = requireEnv('SUPABASE_URL');
  const publishableKey = requireEnv('SUPABASE_PUBLISHABLE_KEY');
  const bearer = extractBearerToken(request);

  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
    global: {
      fetch: createSupabaseFetch(publishableKey),
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    },
  });
}

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * NEVER use this for ordinary reads or user-scoped writes. It is only for
 * guarded webhook/cron handlers that have already verified the caller
 * (signature, shared secret, IP allow-list). Anything else should go
 * through `createServerSupabaseClient` or `requireSupabaseAuth`.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
    global: {
      fetch: createSupabaseFetch(serviceKey),
    },
  });
}
