/**
 * GC-10 — Portfolio finance alerts evaluator (scheduled).
 *
 * Reuses the authoritative portfolio aggregation and the existing in-app
 * notifications inbox. Evaluation is idempotent: alerts are keyed by a stable
 * fingerprint, so a repeat run updates one occurrence per condition and sends
 * no duplicate notifications. One company is evaluated at a time behind a
 * transaction-scoped advisory lock, so two overlapping runs cannot double-write.
 *
 * Operator setup — register once with pg_cron (no secret is embedded here;
 * substitute the project's publishable key at registration time):
 *   select cron.schedule(
 *     'cron-portfolio-alerts', '35 6 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/public/cron/portfolio-alerts',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { evaluateCompanyAlerts } from "@/lib/portfolio-alerts.server";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:portfolio-alerts";

export const Route = createFileRoute("/api/public/cron/portfolio-alerts")({
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
        const ctx = { supabase: admin, user: null } as never;
        const startedAt = Date.now();

        const { data: companies, error } = await admin.from("companies").select("id");
        if (error) {
          if ((error as { code?: string }).code === "42P01") {
            return Response.json({ skipped: true, reason: "companies_missing" });
          }
          return Response.json({ error: "companies_read_failed" }, { status: 500 });
        }

        const results: Record<string, unknown>[] = [];
        for (const c of (companies ?? []) as { id: string }[]) {
          // Advisory lock: a concurrent run for the same company is skipped
          // rather than duplicating evaluation work.
          const { data: locked } = await admin.rpc("portfolio_alerts_try_lock" as never, {
            p_company_id: c.id,
          } as never);
          if (locked === false) {
            results.push({ company_id: c.id, locked_out: true });
            continue;
          }
          try {
            results.push(await evaluateCompanyAlerts(ctx, c.id, { actorId: null }));
          } catch (err) {
            console.error(
              JSON.stringify({
                route: ROUTE,
                company_id: c.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            results.push({ company_id: c.id, failed: true });
          }
        }

        await admin.from("audit_logs").insert({
          company_id: null,
          actor_id: null,
          action: "cron.portfolio_alerts",
          entity: "cron",
          entity_id: null,
          metadata: {
            route: ROUTE,
            duration_ms: Date.now() - startedAt,
            companies: results.length,
          },
        } as never);

        return Response.json({ companies: results.length, results });
      },
    },
  },
});
