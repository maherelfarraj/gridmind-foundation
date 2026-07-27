/**
 * Public health endpoint.
 *
 * GET /api/public/healthz — unauthenticated liveness probe. Reports overall
 * status and DB reachability via a cheap read on a public reference table.
 * Queries via a publishable (anon) Supabase client only — no service-role
 * access, no PII. (The cron_probe heartbeat was retired at the end of
 * consolidation week; cron health is reviewed in cron.job_run_details.)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

        if (!url || !anonKey) {
          return Response.json(
            { status: "degraded", error: "supabase_env_missing" },
            { status: 503 },
          );
        }

        try {
          const supabase = createClient(url, anonKey);
          const { error } = await supabase.from("currencies").select("code").limit(1);

          if (error) {
            return Response.json({ status: "degraded", error: error.message }, { status: 503 });
          }

          return Response.json({ status: "ok", db: "ok" });
        } catch (e) {
          return Response.json(
            { status: "degraded", error: e instanceof Error ? e.message : String(e) },
            { status: 503 },
          );
        }
      },
    },
  },
});

