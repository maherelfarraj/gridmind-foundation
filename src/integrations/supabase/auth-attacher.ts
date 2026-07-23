// NOTE: This file was originally auto-generated. P-005 extends it with a
// server-side stub context and a `requireSupabaseAuth` guard. Real session
// wiring lands in a later batch.
import { createMiddleware } from '@tanstack/react-start'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { supabase } from './client'

export type AuthContext = {
  user: User | null
  supabase: SupabaseClient | null
}

// Registered as a global `functionMiddleware` in `src/start.ts`.
// .client(): attaches the Supabase bearer token to every serverFn RPC.
// .server(): stub — attaches { user: null, supabase: null } context so
// downstream handlers can type against AuthContext today. Real session
// resolution lands in a later batch.
export const attachSupabaseAuth = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  })
  .server(async ({ next }) => {
    const context: AuthContext = { user: null, supabase: null }
    return next({ context })
  })

// Throws a 401 with a numeric `statusCode`, which start.ts re-throws
// untouched so h3 serves the intended status instead of the branded 500.
export function requireSupabaseAuth(
  context: AuthContext,
): asserts context is AuthContext & { user: User } {
  if (context.user == null) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  }
}
