/**
 * P-203 — Daily bond expiry engine.
 *
 * Materializes bond_instruments status from expiry_date, emits escalating
 * threshold notifications (90/60/30/7 days) and writes exactly ONE
 * cron.bond_expiry audit row per company. Fully idempotent: status updates use
 * `status is distinct from <target>` and notifications are fingerprinted with
 * `<instrument_id>:<threshold>` (select-before-insert).
 *
 * pg_cron registration (run once; replace the anon key):
 *   select cron.schedule(
 *     'cron-bond-expiry', '17 6 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/public/cron/bond-expiry',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import {
  bondDaysToExpiry,
  bondFingerprint,
  bondNoticeMessage,
  crossedThresholds,
  materializedStatus,
  rolesForThreshold,
  type MaterializedStatus,
} from "@/lib/finance/bond-expiry";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:bond-expiry";

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

function isMissingTable(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code && MISSING_TABLE_CODES.has(e.code)) return true;
  return /does not exist|could not find the table/i.test(e.message ?? "");
}

function skipped(reason: string): Response {
  console.warn(JSON.stringify({ route: ROUTE, skipped: true, reason }));
  return Response.json({ skipped: true, reason }, { status: 200 });
}

interface InstrumentRow {
  id: string;
  company_id: string;
  instrument_number: string;
  instrument_type: string;
  beneficiary_name: string;
  expiry_date: string;
  amount: number;
  currency_code: string;
  status: string;
}

export const Route = createFileRoute("/api/public/cron/bond-expiry")({
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
          action: "cron.bond_expiry.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
            const today = new Date().toISOString().slice(0, 10);

            const listRes = await admin
              .from("bond_instruments")
              .select(
                "id, company_id, instrument_number, instrument_type, beneficiary_name, expiry_date, amount, currency_code, status",
              )
              .in("status", ["active", "expiring_soon"])
              .not("expiry_date", "is", null);
            if (listRes.error) {
              if (isMissingTable(listRes.error)) return skipped("bond_instruments_missing");
              return Response.json({ error: "instruments_read_failed" }, { status: 500 });
            }

            const byCompany = new Map<string, InstrumentRow[]>();
            for (const row of (listRes.data ?? []) as unknown as InstrumentRow[]) {
              const list = byCompany.get(row.company_id) ?? [];
              list.push(row);
              byCompany.set(row.company_id, list);
            }

            let totalNotifications = 0;
            let totalExpired = 0;

            for (const [companyId, rows] of byCompany) {
              // ---- 1. Idempotent status materialization -------------------------
              const buckets = new Map<MaterializedStatus, InstrumentRow[]>();
              for (const row of rows) {
                const target = materializedStatus(bondDaysToExpiry(row.expiry_date, today));
                if (!target) continue;
                const list = buckets.get(target) ?? [];
                list.push(row);
                buckets.set(target, list);
              }

              let expiredCount = 0;
              let expiringCount = 0;
              for (const [target, list] of buckets) {
                const changed = list.filter((r) => r.status !== target);
                if (changed.length === 0) continue;
                const updRes = await admin
                  .from("bond_instruments")
                  .update({ status: target } as never)
                  .in(
                    "id",
                    changed.map((r) => r.id),
                  )
                  .neq("status", target as never)
                  .select("id");
                if (updRes.error) {
                  if (isMissingTable(updRes.error)) return skipped("bond_instruments_missing");
                  return Response.json({ error: "status_update_failed" }, { status: 500 });
                }
                const updatedIds = new Set(
                  ((updRes.data ?? []) as Array<{ id: string }>).map((r) => r.id),
                );
                if (target === "expired") {
                  expiredCount += updatedIds.size;
                  totalExpired += updatedIds.size;
                  const newlyExpired = changed.filter((r) => updatedIds.has(r.id));
                  if (newlyExpired.length > 0) {
                    await admin.from("audit_logs").insert(
                      newlyExpired.map((r) => ({
                        company_id: companyId,
                        actor_id: null,
                        action: "bond.expired",
                        entity: "bond_instruments",
                        entity_id: r.id,
                        metadata: { instrument_id: r.id, expiry_date: r.expiry_date },
                      })) as never,
                    );
                  }
                }
              }
              expiringCount = (buckets.get("expiring_soon") ?? []).length;

              // ---- 2. Threshold notifications -----------------------------------
              const candidates: Array<{ row: InstrumentRow; threshold: number; days: number }> = [];
              for (const row of rows) {
                const days = bondDaysToExpiry(row.expiry_date, today);
                if (days === null) continue;
                for (const threshold of crossedThresholds(days)) {
                  candidates.push({ row, threshold, days });
                }
              }

              let notificationCount = 0;
              if (candidates.length > 0) {
                const fingerprints = [
                  ...new Set(candidates.map((c) => bondFingerprint(c.row.id, c.threshold))),
                ];
                const existingRes = await admin
                  .from("notifications")
                  .select("user_id, metadata")
                  .eq("company_id", companyId as never)
                  .in("metadata->>bond_fingerprint", fingerprints as never);
                if (existingRes.error && !isMissingTable(existingRes.error)) {
                  return Response.json({ error: "notification_read_failed" }, { status: 500 });
                }
                const seen = new Set(
                  (
                    (existingRes.data ?? []) as Array<{
                      user_id: string;
                      metadata: { bond_fingerprint?: string } | null;
                    }>
                  ).map((n) => `${n.metadata?.bond_fingerprint ?? ""}|${n.user_id}`),
                );

                const roles = [
                  ...new Set(candidates.flatMap((c) => rolesForThreshold(c.threshold))),
                ];
                const holdersRes = await admin
                  .from("user_roles")
                  .select("user_id, role")
                  .eq("company_id", companyId as never)
                  .in("role", roles as never);
                const holders = new Map<string, string[]>();
                for (const h of (holdersRes.data ?? []) as Array<{
                  user_id: string;
                  role: string;
                }>) {
                  const list = holders.get(h.role) ?? [];
                  if (!list.includes(h.user_id)) list.push(h.user_id);
                  holders.set(h.role, list);
                }

                const inserts: Array<Record<string, unknown>> = [];
                for (const { row, threshold, days } of candidates) {
                  const fp = bondFingerprint(row.id, threshold);
                  const recipients = new Set(
                    rolesForThreshold(threshold).flatMap((r) => holders.get(r) ?? []),
                  );
                  for (const userId of recipients) {
                    const key = `${fp}|${userId}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    inserts.push({
                      user_id: userId,
                      company_id: companyId,
                      type: "bond.expiring",
                      title: `Bond expiring in ${threshold} days or less`,
                      body: bondNoticeMessage(row, days),
                      link: "/finance/bonds?expiring=30",
                      metadata: {
                        bond_fingerprint: fp,
                        instrument_id: row.id,
                        threshold,
                        days_to_expiry: days,
                      },
                    });
                  }
                }

                if (inserts.length > 0) {
                  const insRes = await admin.from("notifications").insert(inserts as never);
                  if (insRes.error) {
                    if (isMissingTable(insRes.error)) return skipped("notifications_missing");
                    return Response.json({ error: "notification_insert_failed" }, { status: 500 });
                  }
                  notificationCount = inserts.length;
                  totalNotifications += inserts.length;
                }
              }

              // ---- 3. Exactly one summary audit row per company -----------------
              await admin.from("audit_logs").insert({
                company_id: companyId,
                actor_id: null,
                action: "cron.bond_expiry",
                entity: "cron",
                entity_id: null,
                metadata: {
                  expired: expiredCount,
                  expiring_soon: expiringCount,
                  notifications: notificationCount,
                },
              } as never);
            }

            return Response.json({
              companies: byCompany.size,
              expired: totalExpired,
              notifications: totalNotifications,
            });
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.bond_expiry.success",
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
            action: "cron.bond_expiry.failure",
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
