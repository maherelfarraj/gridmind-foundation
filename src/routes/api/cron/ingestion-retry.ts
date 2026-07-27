/**
 * P-177 — Ingestion retry processor.
 *
 * Drains due rows from ingestion_retry_queue, replays them against
 * scada_telemetry / scada_events, applies the backoff ladder
 * (1m → 5m → 30m → 2h → 24h) and dead-letters after max_attempts.
 *
 * Writes exactly one cron.ingestion_retry summary audit row per company
 * per run so /admin/health surfaces freshness.
 *
 * pg_cron registration (every 5 minutes):
 *   select cron.schedule(
 *     'cron-ingestion-retry', '*\/5 * * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/ingestion-retry',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";
import { processIngestionRetries } from "@/lib/scada-retry.server";

const ROUTE = "cron:ingestion-retry";

export const Route = createFileRoute("/api/cron/ingestion-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ROUTE,
          allowCron: true,
          rateCapacity: 12,
          rateRefillPerSec: 0.05,
        });
        if (!guard.ok) return guard.response;
        if (guard.caller.kind !== "cron") {
          return Response.json({ error: "cron_only" }, { status: 403 });
        }

        const admin = createServiceRoleClient();

        const __auditStartedAt = Date.now();
        const __scheduledAt = new Date().toISOString();
        await admin.from("audit_logs").insert({
          company_id: null,
          actor_id: null,
          action: "cron.ingestion_retry.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
            const summary = await processIngestionRetries(admin);

            if (summary.queue_missing) {
              return Response.json({ error: "queue_unavailable" }, { status: 503 });
            }

            for (const [companyId, s] of summary.perCompany) {
              await admin.from("audit_logs").insert({
                company_id: companyId,
                actor_id: null,
                action: "cron.ingestion_retry",
                entity: "cron",
                entity_id: null,
                metadata: {
                  route: ROUTE,
                  processed: s.processed,
                  succeeded: s.succeeded,
                  requeued: s.requeued,
                  dead_lettered: s.dead_lettered,
                },
              } as never);
            }

            return Response.json({
              processed: summary.processed,
              succeeded: summary.succeeded,
              requeued: summary.requeued,
              dead_lettered: summary.dead_lettered,
              companies_affected: summary.perCompany.size,
            });
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.ingestion_retry.success",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              result_summary: { status: __result.status },
            },
          } as never);
          return __result;
        } catch (__err) {
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.ingestion_retry.failure",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              error_message: __err instanceof Error ? __err.message : String(__err),
            },
          } as never);
          throw __err;
        }
      },
    },
  },
});
