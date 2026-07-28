// Shared GoTrue backoff helper.
//
// When the whole suite runs in parallel every fixture signs users in against
// one GoTrue instance, which rate-limits (429 "Request rate limit reached")
// and turns healthy suites red at random. Every test sign-in goes through
// this helper: exponential backoff with jitter on rate-limit / transient
// failures, so contention costs a few seconds instead of a false failure.

import type { AuthTokenResponsePassword, SupabaseClient } from "@supabase/supabase-js";

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: { status?: number; message?: string } | null): boolean {
  if (!err) return false;
  if (err.status === 429 || err.status === 503 || err.status === 504) return true;
  return /rate limit|too many requests|fetch failed|timeout|temporarily/i.test(err.message ?? "");
}

/** Sign in with exponential backoff + jitter on GoTrue rate limits. */
export async function signInWithBackoff(
  client: SupabaseClient<never> | SupabaseClient<never, never, never>,
  email: string,
  password: string,
): Promise<AuthTokenResponsePassword> {
  let last: AuthTokenResponsePassword | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const auth = (client as unknown as SupabaseClient).auth;
    const res = (await auth.signInWithPassword({ email, password })) as AuthTokenResponsePassword;
    if (res.data?.session) return res;
    last = res;
    if (!isRetryable(res.error as { status?: number; message?: string } | null)) return res;
    const backoff = BASE_DELAY_MS * 2 ** attempt;
    await sleep(backoff + Math.random() * backoff);
  }
  return last as AuthTokenResponsePassword;
}

/** Admin createUser with the same backoff — the admin endpoint shares the bucket. */
export async function createUserWithBackoff(
  svc: SupabaseClient<never>,
  args: { email: string; password: string },
): Promise<{ user: { id: string } }> {
  let lastMessage = "createUser failed";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await (svc as unknown as SupabaseClient).auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: true,
    });
    if (data?.user) return { user: { id: data.user.id } };
    lastMessage = error?.message ?? lastMessage;
    if (!isRetryable(error as { status?: number; message?: string } | null)) break;
    const backoff = BASE_DELAY_MS * 2 ** attempt;
    await sleep(backoff + Math.random() * backoff);
  }
  throw new Error(lastMessage);
}
