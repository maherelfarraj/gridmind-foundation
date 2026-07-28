/**
 * P-260 — Compliance expiry sweep cron.
 *
 * Calls `sub_compliance_expiry_sweep()`, which refreshes every derived status
 * and raises AT MOST ONE notification per (document, state, expiry date) via
 * the `compliance_fingerprint` unique index — re-runs are a no-op.
 *
 * pg_cron registration (run once; replace the anon key):
 *   select cron.schedule(
 *     'cron-compliance-expiry', '25 5 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/public/cron/compliance-expiry',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:compliance-expiry";

export const Route = createFileRoute("/api/public/cron/compliance-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ROUTE,
          allowCron: true,
          rateCapacity: 4,
          rateRefillPerSec: 0.02,
        });
        if (!guard.ok) return guard.response;
        if (guard.caller.kind !== "cron") {
          return Response.json({ error: "cron_only" }, { status: 403 });
        }

        const admin = createServiceRoleClient();
        const startedAt = Date.now();
        const { data, error } = await admin.rpc("sub_compliance_expiry_sweep");
        if (error) {
          console.error(JSON.stringify({ route: ROUTE, error: error.message }));
          return Response.json({ error: "sweep_failed" }, { status: 500 });
        }
        const result = (data ?? {}) as { refreshed?: number; alerts?: number };

        console.warn(
          JSON.stringify({
            route: ROUTE,
            refreshed: Number(result.refreshed ?? 0),
            alerts: Number(result.alerts ?? 0),
            duration_ms: Date.now() - startedAt,
          }),
        );

        return Response.json({
          ok: true,
          refreshed: Number(result.refreshed ?? 0),
          alerts: Number(result.alerts ?? 0),
        });
      },
    },
  },
});
