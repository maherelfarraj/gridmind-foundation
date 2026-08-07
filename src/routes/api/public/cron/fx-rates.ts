/**
 * FX-01 — Daily exchange-rate import cron.
 *
 * Signed, cron-only. Reuses guardPublicHook (bearer/apikey auth, cf-connecting-ip
 * allowlist, ±300s timestamped HMAC replay protection, token-bucket rate limit).
 * It accepts no caller-supplied provider/URL, so it can never be used as a
 * generic outbound proxy.
 *
 * pg_cron registration (17:30 Europe/Amman = 14:30 UTC; DST-free zone):
 *   select cron.schedule(
 *     'cron-fx-rates', '30 14 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/public/cron/fx-rates',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { runFxImport } from "@/lib/fx/import.server";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:fx-rates";

export const Route = createFileRoute("/api/public/cron/fx-rates")({
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
        const result = await runFxImport(admin as never, { trigger: "scheduled" });
        console.info(JSON.stringify({ route: ROUTE, ...result }));
        return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
      },
    },
  },
});
