/**
 * P-123 — Audit-log retention sweep.
 *
 * For each row in audit_log_retention_policies, deletes rows from audit_logs
 * older than `retention_days`. Batched (5,000 rows/loop) with a hard cap of
 * 50,000 deletions/run so we stay well inside Cloudflare Worker CPU limits.
 * The retention_days CHECK (>= 90) is enforced at the DB level; financial
 * entities default to 2555 days (7 years) via the table default and are
 * never truncated below that unless an operator explicitly configures a
 * shorter policy (which the CHECK still floors at 90).
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
const BATCH_SIZE = 5_000;
const HARD_CAP_PER_RUN = 50_000;
const MIN_RETENTION_DAYS = 90; // DB CHECK constraint; mirrored here defensively.

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

        const policies = await admin
          .from("audit_log_retention_policies")
          .select("company_id, entity, retention_days");

        if (policies.error && (policies.error as { code?: string }).code === "42P01") {
          return Response.json(
            { skipped: true, reason: "retention_policies_missing" },
            { status: 200 },
          );
        }
        if (policies.error) {
          return Response.json(
            { error: "query_failed", message: policies.error.message },
            { status: 500 },
          );
        }

        const perCompany = new Map<string, number>();
        let totalDeleted = 0;

        for (const p of (policies.data ?? []) as Array<{
          company_id: string;
          entity: string;
          retention_days: number;
        }>) {
          if (totalDeleted >= HARD_CAP_PER_RUN) break;
          const days = Math.max(MIN_RETENTION_DAYS, p.retention_days);
          const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

          let policyDeleted = 0;
          // Batch-delete until nothing left or hard cap reached. Each round
          // selects up to BATCH_SIZE ids then deletes by id list — that keeps
          // the delete bounded and PostgREST-friendly (no unbounded DELETE).
          // Loop count is capped implicitly by HARD_CAP_PER_RUN / BATCH_SIZE.
          for (let round = 0; round < Math.ceil(HARD_CAP_PER_RUN / BATCH_SIZE); round++) {
            if (totalDeleted >= HARD_CAP_PER_RUN) break;
            const remaining = HARD_CAP_PER_RUN - totalDeleted;
            const takeN = Math.min(BATCH_SIZE, remaining);

            const batch = await admin
              .from("audit_logs")
              .select("id")
              .eq("company_id", p.company_id)
              .eq("entity", p.entity)
              .lt("created_at", cutoff)
              .limit(takeN);
            if (batch.error) break;
            const ids = ((batch.data ?? []) as Array<{ id: string }>).map((r) => r.id);
            if (ids.length === 0) break;

            const del = await admin.from("audit_logs").delete().in("id", ids);
            if (del.error) break;
            policyDeleted += ids.length;
            totalDeleted += ids.length;
            if (ids.length < takeN) break;
          }

          if (policyDeleted > 0) {
            perCompany.set(
              p.company_id,
              (perCompany.get(p.company_id) ?? 0) + policyDeleted,
            );
          }
        }

        // Per-company summary audit. Written AFTER the sweep so it can never
        // be swept away in its own run (cutoff is in the past).
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
              hard_cap_reached: totalDeleted >= HARD_CAP_PER_RUN,
            },
          } as never);
        }

        return Response.json({
          deleted: totalDeleted,
          companies_affected: perCompany.size,
          hard_cap_reached: totalDeleted >= HARD_CAP_PER_RUN,
        });
      },
    },
  },
});
