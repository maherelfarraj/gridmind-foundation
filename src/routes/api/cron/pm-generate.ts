// P-107 — Cron endpoint stub for preventive maintenance auto-generation.
// TODO(B13/P-123): wrap in guardPublicHook + register pg_cron schedule (daily 05:00 UTC).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { generatePmWorkOrders } from "@/lib/pm-plans.server";

export const Route = createFileRoute("/api/cron/pm-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!expected || !apikey || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const url = process.env.SUPABASE_URL!;
        const client = createClient<Database>(url, expected, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        try {
          const summary = await generatePmWorkOrders(client);
          return new Response(JSON.stringify(summary), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ error: "generation_failed", message: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
