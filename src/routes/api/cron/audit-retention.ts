/**
 * P-135 — Audit-log retention sweep (upgraded from P-123).
 *
 * Delegates the actual deletion to the SECURITY DEFINER function
 * public.enforce_audit_log_retention(), which:
 *   - honours audit_log_retention_policies (floored at 90 days),
 *   - falls back to 2555 days (7y) for financial entities without a policy,
 *   - is executable only by service_role (audit_logs stays append-only for
 *     every other role).
 *
 * This route stays behind the /api/cron guard (P-121) so only the cron caller
 * can trigger it, and still writes a per-company cron.audit_retention summary
 * audit row on success so /admin/health surfaces recent runs.
 *
 * pg_cron registration (daily 03:17 UTC — off-peak):
 *   select cron.schedule(
 *     'cron-audit-retention', '17 3 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/audit-retention',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:audit-retention";

type RetentionRow = {
  company_id: string;
  entity: string;
  deleted_count: number | string;
};

export const Route = createFileRoute("/api/cron/audit-retention")({
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

        const __auditStartedAt = Date.now();
        const __scheduledAt = new Date().toISOString();
        await admin.from("audit_logs").insert({
          company_id: null,
          actor_id: null,
          action: "cron.audit_retention.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {

        const { data, error } = await admin.rpc("enforce_audit_log_retention");
        if (error) {
          return Response.json(
            { error: "retention_failed", message: error.message },
            { status: 500 },
          );
        }

        const rows = (data ?? []) as RetentionRow[];
        const perCompany = new Map<string, number>();
        let totalDeleted = 0;
        for (const r of rows) {
          const n = typeof r.deleted_count === "string" ? Number(r.deleted_count) : r.deleted_count;
          if (!Number.isFinite(n) || n <= 0) continue;
          perCompany.set(r.company_id, (perCompany.get(r.company_id) ?? 0) + n);
          totalDeleted += n;
        }

        // Per-company summary audit (mirrors P-123 behaviour so /admin/health
        // continues to see recent cron.audit_retention rows).
        for (const [companyId, deleted] of perCompany) {
          await admin.from("audit_logs").insert({
            company_id: companyId,
            actor_id: null,
            action: "cron.audit_retention",
            entity: "cron",
            entity_id: null,
            metadata: {
              route: ROUTE,
              deleted,
              via: "enforce_audit_log_retention",
            },
          } as never);
        }

        return Response.json({
          deleted: totalDeleted,
          companies_affected: perCompany.size,
          policies_applied: rows.length,
        });
      
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.audit_retention.success",
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
            action: "cron.audit_retention.failure",
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
