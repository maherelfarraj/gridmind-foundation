// P-133 — E2E smoke helpers.
//
// No browser automation. Auth via Supabase HTTP API (signInWithPassword);
// state-changing actions go through the authenticated Supabase client (RLS
// enforced as the user) exercising the same DB functions, RPCs, and
// triggers the server-function handlers use. Fixture setup/teardown uses a
// service-role client that never appears in assertions.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export function envReady(): boolean {
  return !!URL_ && !!ANON && !!SERVICE;
}

export function service(): SupabaseClient<Database> {
  return createClient<Database>(URL_, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; userId: string; client: SupabaseClient<Database> }> {
  const c = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('login failed');
  const token = data.session.access_token;
  const userId = data.user!.id;
  const authed = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { token, userId, client: authed };
}
