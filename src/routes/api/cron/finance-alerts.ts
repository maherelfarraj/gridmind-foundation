/**
 * P-199 — Finance alerts cron.
 *
 * Evaluates every enabled finance_alert_rules row per company, inserts alerts
 * (unique(rule_id, entity_type, entity_id, alert_date) + on conflict do
 * nothing makes re-runs a no-op), notifies notify_role holders for NEW alerts
 * only, then writes exactly ONE cron.finance_alerts audit row per company.
 *
 * pg_cron registration (run once; replace the anon key):
 *   select cron.schedule(
 *     'cron-finance-alerts', '17 6 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/finance-alerts',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import {
  MissingTableError,
  evaluateCompanyRules,
  type CompanyRule,
} from "@/lib/finance-alerts.cron";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:finance-alerts";

function skipped(reason: string): Response {
  console.warn(JSON.stringify({ route: ROUTE, skipped: true, reason }));
  return Response.json({ skipped: true, reason }, { status: 200 });
}

export const Route = createFileRoute("/api/cron/finance-alerts")({
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
          action: "cron.finance_alerts.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
            const today = new Date().toISOString().slice(0, 10);

            const rulesRes = await admin
              .from("finance_alert_rules")
              .select("id, company_id, rule_type, threshold, notify_role")
              .eq("enabled", true as never);
            if (rulesRes.error) {
              if ((rulesRes.error as { code?: string }).code === "42P01") {
                return skipped("finance_alert_rules_missing");
              }
              return Response.json({ error: "rules_read_failed" }, { status: 500 });
            }

            const byCompany = new Map<string, CompanyRule[]>();
            for (const r of (rulesRes.data ?? []) as unknown as CompanyRule[]) {
              const list = byCompany.get(r.company_id) ?? [];
              list.push(r);
              byCompany.set(r.company_id, list);
            }

            let created = 0;
            for (const [companyId, rules] of byCompany) {
              let outcomes;
              try {
                outcomes = await evaluateCompanyRules(admin as never, companyId, rules, today);
              } catch (err) {
                if (err instanceof MissingTableError) return skipped(`${err.table}_missing`);
                return Response.json({ error: "evaluation_failed" }, { status: 500 });
              }

              const counts: Record<string, number> = {};
              for (const { rule, candidates } of outcomes) {
                if (candidates.length === 0) {
                  counts[rule.rule_type] = counts[rule.rule_type] ?? 0;
                  continue;
                }
                const insertRes = await admin
                  .from("finance_alerts")
                  .upsert(
                    candidates.map((c) => ({
                      company_id: companyId,
                      rule_id: rule.id,
                      entity_type: c.entity_type,
                      entity_id: c.entity_id,
                      alert_date: today,
                      severity: c.severity,
                      message: c.message,
                      metadata: c.metadata,
                    })) as never,
                    {
                      onConflict: "rule_id,entity_type,entity_id,alert_date",
                      ignoreDuplicates: true,
                    },
                  )
                  .select("id");
                if (insertRes.error) {
                  if ((insertRes.error as { code?: string }).code === "42P01") {
                    return skipped("finance_alerts_missing");
                  }
                  return Response.json({ error: "alert_insert_failed" }, { status: 500 });
                }
                const newRows = (insertRes.data ?? []) as Array<{ id: string }>;
                counts[rule.rule_type] = (counts[rule.rule_type] ?? 0) + newRows.length;
                created += newRows.length;

                if (newRows.length > 0) {
                  const { data: recipients } = await admin
                    .from("user_roles")
                    .select("user_id")
                    .eq("company_id", companyId as never)
                    .eq("role", rule.notify_role as never);
                  const ids = Array.from(
                    new Set(
                      ((recipients ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
                    ),
                  );
                  if (ids.length > 0) {
                    await admin.from("notifications").insert(
                      ids.map((uid) => ({
                        user_id: uid,
                        company_id: companyId,
                        type: "finance.alert",
                        title: "New finance alerts",
                        body: `${newRows.length} new ${rule.rule_type.replace(/_/g, " ")} alert(s).`,
                        entity_type: "finance_alerts",
                      })) as never,
                    );
                  }
                }
              }

              await admin.from("audit_logs").insert({
                company_id: companyId,
                actor_id: null,
                action: "cron.finance_alerts",
                entity: "cron",
                entity_id: null,
                metadata: { route: ROUTE, alert_date: today, counts },
              } as never);
            }

            return Response.json({ companies: byCompany.size, created });
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.finance_alerts.success",
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
            action: "cron.finance_alerts.failure",
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
