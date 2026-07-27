/**
 * Public health endpoint.
 *
 * GET /api/public/healthz — unauthenticated liveness probe. Reports overall
 * status, DB reachability, and the timestamp of the most recent cron_probe
 * heartbeat row (used to detect stalled pg_cron scheduling). Queries via a
 * publishable (anon) Supabase client only — no service-role access, no PII.
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
          const { data, error } = await supabase
            .from("cron_probe")
            .select("fired_at")
            .order("fired_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            return Response.json(
              { status: "degraded", error: error.message },
              { status: 503 },
            );
          }

          return Response.json({
            status: "ok",
            db: "ok",
            cron_probe_last_fired_at:
              (data as { fired_at?: string } | null)?.fired_at ?? null,
          });
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
