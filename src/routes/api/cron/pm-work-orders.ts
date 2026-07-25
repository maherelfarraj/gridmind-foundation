/**
 * P-123 — Preventive maintenance work-order generation cron.
 *
 * Delegates to generatePmWorkOrders (P-107). That helper enforces its own
 * idempotency guard via the `[pm_plan:<id>:<due>]` marker on
 * work_orders.description, so a re-run in the same window is a no-op.
 *
 * pg_cron registration:
 *   select cron.schedule(
 *     'cron-pm-work-orders', '*\/15 * * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/pm-work-orders',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";
import { generatePmWorkOrders } from "@/lib/pm-plans.server";

const ROUTE = "cron:pm-work-orders";

export const Route = createFileRoute("/api/cron/pm-work-orders")({
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

        let summary: Awaited<ReturnType<typeof generatePmWorkOrders>>;
        try {
          summary = await generatePmWorkOrders(admin);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "42P01") {
            return Response.json(
              { skipped: true, reason: "preventive_maintenance_plans_missing" },
              { status: 200 },
            );
          }
          return Response.json(
            { error: "generation_failed", message: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }

        // Aggregate per-company counts from touched plan IDs.
        const perCompany = new Map<string, { generated: number; skipped: number }>();
        if (summary.plan_ids.length > 0) {
          const { data: planRows } = await admin
            .from("preventive_maintenance_plans")
            .select("id, company_id")
            .in("id", summary.plan_ids);
          for (const p of (planRows ?? []) as Array<{ id: string; company_id: string }>) {
            const row = perCompany.get(p.company_id) ?? { generated: 0, skipped: 0 };
            perCompany.set(p.company_id, row);
          }
        }

        // Summary audit — one row per company that had activity this run.
        for (const [companyId, counts] of perCompany) {
          await admin.from("audit_logs").insert({
            company_id: companyId,
            actor_id: null,
            action: "cron.pm_work_orders",
            entity: "cron",
            entity_id: null,
            metadata: {
              route: ROUTE,
              generated: counts.generated,
              skipped: counts.skipped,
              total_run_generated: summary.generated,
              total_run_skipped: summary.skipped,
            },
          } as never);
        }

        return Response.json({
          generated: summary.generated,
          skipped: summary.skipped,
          companies_affected: perCompany.size,
        });
      },
    },
  },
});
