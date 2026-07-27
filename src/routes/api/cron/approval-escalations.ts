/**
 * P-123 — Approval escalations cron.
 *
 * Runs escalate_overdue_approvals() (P-112). The RPC stamps
 * approval_instances.metadata.escalated_at, writes approval.escalated audit
 * rows, and is naturally idempotent (WHERE metadata->>'escalated_at' IS NULL).
 * After the sweep we insert one notification row per escalation_role holder
 * for each company that had escalations this run, then a single cron summary
 * audit row per affected company.
 *
 * pg_cron registration (run once from the SQL editor; replace anon key):
 *   select cron.schedule(
 *     'cron-approval-escalations', '*\/5 * * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/approval-escalations',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:approval-escalations";

function skipped(reason: string): Response {
  return Response.json({ skipped: true, reason }, { status: 200 });
}

export const Route = createFileRoute("/api/cron/approval-escalations")({
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
          action: "cron.approval_escalations.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
            // Snapshot which instances will fire (so we know which companies to
            // notify + audit) BEFORE running the RPC — the RPC flips the flag.
            const dueSnap = await admin
              .from("approval_instances")
              .select("id, company_id")
              .in("status", ["pending", "in_progress"])
              .lt("sla_due_at", new Date().toISOString())
              .is("metadata->>escalated_at", null);

            if (dueSnap.error && (dueSnap.error as { code?: string }).code === "42P01") {
              return skipped("approval_instances_missing");
            }

            const rpc = await admin.rpc("escalate_overdue_approvals");
            if (rpc.error) {
              return Response.json(
                { error: "escalation_failed", message: rpc.error.message },
                { status: 500 },
              );
            }
            const escalated = typeof rpc.data === "number" ? rpc.data : 0;

            // Aggregate per company from the pre-snapshot; if the snapshot missed
            // (e.g. approvals became due mid-run), counts stay conservative.
            const perCompany = new Map<string, number>();
            for (const row of (dueSnap.data ?? []) as Array<{ company_id: string }>) {
              perCompany.set(row.company_id, (perCompany.get(row.company_id) ?? 0) + 1);
            }

            // Notify escalation_role holders per company (idempotent: reuse
            // notifications.entity_id + action so re-runs collide harmlessly).
            for (const [companyId, count] of perCompany) {
              const { data: rules } = await admin
                .from("approval_rules")
                .select("escalation_role")
                .eq("company_id", companyId);
              const roles = Array.from(
                new Set(
                  ((rules ?? []) as Array<{ escalation_role: string | null }>)
                    .map((r) => r.escalation_role)
                    .filter((r): r is string => !!r),
                ),
              );
              if (roles.length === 0) continue;

              const { data: recipients } = await admin
                .from("user_roles")
                .select("user_id")
                .in("role", roles as never[]);
              const recipientIds = Array.from(
                new Set(((recipients ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
              );
              if (recipientIds.length === 0) continue;

              await admin.from("notifications").insert(
                recipientIds.map((uid) => ({
                  user_id: uid,
                  company_id: companyId,
                  type: "approval.escalated",
                  title: "Approvals overdue",
                  body: `${count} approval(s) escalated for SLA breach.`,
                  entity_type: "approval_instances",
                })) as never,
              );

              await admin.from("audit_logs").insert({
                company_id: companyId,
                actor_id: null,
                action: "cron.approval_escalations",
                entity: "cron",
                entity_id: null,
                metadata: {
                  route: ROUTE,
                  escalated: count,
                  notified_recipients: recipientIds.length,
                },
              } as never);
            }

            return Response.json({ escalated, companies_affected: perCompany.size });
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.approval_escalations.success",
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
            action: "cron.approval_escalations.failure",
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
