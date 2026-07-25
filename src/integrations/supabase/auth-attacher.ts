// Real per-request Supabase auth attacher (P-021).
// Runs on every createServerFn RPC:
//   .client(): attaches Authorization: Bearer <access_token> from the browser session.
//   .server(): resolves the user via a per-request server client. Never throws —
//     public RPCs must work. Callers that require a session use requireSupabaseAuth().
// Never uses the service-role key.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "./client";
import { createServerSupabaseClient } from "./server";
import type { Database } from "./types";

export type AuthContext = {
  user: User | null;
  supabase: SupabaseClient<Database>;
};

export const attachSupabaseAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  })
  .server(async ({ next }) => {
    const request = getRequest();
    const supabaseServer = createServerSupabaseClient(request);
    let user: User | null = null;
    try {
      const { data, error } = await supabaseServer.auth.getUser();
      if (!error) user = data.user ?? null;
    } catch {
      user = null;
    }
    const context: AuthContext = { user, supabase: supabaseServer };
    return next({ context });
  });

// Throws a 401 with a numeric statusCode + JSON body. src/start.ts's
// errorMiddleware detects `statusCode` and serves the body verbatim
// instead of the branded HTML 500 page.
export function requireSupabaseAuth(
  context: AuthContext,
): asserts context is AuthContext & { user: User } {
  if (context.user == null) {
    throw Object.assign(new Error("Unauthorized"), {
      statusCode: 401,
      body: JSON.stringify({ error: "unauthorized" }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
