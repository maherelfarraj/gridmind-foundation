/**
 * P-125 — Outbound webhook dispatcher.
 *
 * Cron-only. Picks up to 50 pending deliveries whose `next_retry_at <= now()`,
 * signs each with the endpoint's raw secret (from webhook_endpoint_secrets),
 * POSTs the JSON payload with a 10s timeout, and records the outcome.
 *
 * Signing recipe (documented in P-127):
 *   x-gridmind-timestamp: <unix seconds>
 *   x-gridmind-signature: sha256=<hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))>
 *
 * Retry schedule (attempts already incremented on the record before scheduling):
 *   1st retry:   +1 min
 *   2nd retry:   +5 min
 *   3rd retry:   +30 min
 *   4th retry:   +2 h
 *   5th retry:   +24 h
 *   after that:  status='failed'
 *
 * pg_cron registration (every 5 minutes):
 *   select cron.schedule(
 *     'cron-webhook-dispatch', '* / 5 * * * *'  -- (no spaces around slash)
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/webhook-dispatch',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook, hmacSha256Hex } from "@/lib/public-api/guard";

const ROUTE = "cron:webhook-dispatch";
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_CAP = 2048;
const MAX_ATTEMPTS = 5;

// attempts value BEFORE the current send. Backoff table indexed by that.
// (attempts=0 means first try; on failure we schedule the 1st retry.)
const BACKOFF_MS: number[] = [
  60_000,        // after attempt 1 → retry in 1 min
  5 * 60_000,    // after attempt 2 → retry in 5 min
  30 * 60_000,   // after attempt 3 → retry in 30 min
  2 * 60 * 60_000,   // after attempt 4 → retry in 2 h
  24 * 60 * 60_000,  // after attempt 5 → retry in 24 h (only used if MAX_ATTEMPTS raised)
];

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  company_id: string;
  event: string;
  payload: unknown;
  attempts: number;
}

export const Route = createFileRoute("/api/cron/webhook-dispatch")({
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
        const nowIso = new Date().toISOString();

        // Claim pending deliveries whose retry time has arrived.
        const claim = await admin
          .from("webhook_deliveries")
          .select("id, endpoint_id, company_id, event, payload, attempts")
          .eq("status", "pending")
          .lte("next_retry_at", nowIso)
          .order("next_retry_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (claim.error && (claim.error as { code?: string }).code === "42P01") {
          return Response.json({ skipped: true, reason: "deliveries_missing" });
        }
        if (claim.error) {
          return Response.json(
            { error: "query_failed", message: claim.error.message },
            { status: 500 },
          );
        }

        const deliveries = (claim.data ?? []) as DeliveryRow[];
        if (deliveries.length === 0) {
          return Response.json({ processed: 0, success: 0, failed: 0, retried: 0 });
        }

        // Fetch endpoints + secrets for all target endpoints in one shot.
        const endpointIds = Array.from(new Set(deliveries.map((d) => d.endpoint_id)));
        const [epRes, secRes] = await Promise.all([
          admin
            .from("webhook_endpoints")
            .select("id, url, is_active")
            .in("id", endpointIds),
          admin
            .from("webhook_endpoint_secrets")
            .select("endpoint_id, secret")
            .in("endpoint_id", endpointIds),
        ]);
        if (epRes.error || secRes.error) {
          return Response.json({ error: "endpoint_fetch_failed" }, { status: 500 });
        }
        const epMap = new Map<string, { url: string; is_active: boolean }>();
        for (const e of (epRes.data ?? []) as Array<{
          id: string;
          url: string;
          is_active: boolean;
        }>) {
          epMap.set(e.id, { url: e.url, is_active: e.is_active });
        }
        const secMap = new Map<string, string>();
        for (const s of (secRes.data ?? []) as Array<{
          endpoint_id: string;
          secret: string;
        }>) {
          secMap.set(s.endpoint_id, s.secret);
        }

        const perCompany = new Map<
          string,
          { success: number; failed: number; retried: number; skipped: number }
        >();
        function bump(
          companyId: string,
          key: "success" | "failed" | "retried" | "skipped",
        ) {
          const cur = perCompany.get(companyId) ?? {
            success: 0,
            failed: 0,
            retried: 0,
            skipped: 0,
          };
          cur[key]++;
          perCompany.set(companyId, cur);
        }

        let success = 0;
        let failed = 0;
        let retried = 0;

        for (const d of deliveries) {
          const endpoint = epMap.get(d.endpoint_id);
          const secret = secMap.get(d.endpoint_id);

          // Missing endpoint or secret → mark failed (nothing to send).
          if (!endpoint || !secret) {
            await admin
              .from("webhook_deliveries")
              .update({
                status: "failed" as const,
                attempts: d.attempts + 1,
                response_body: !endpoint
                  ? "endpoint_missing"
                  : "signing_secret_missing",
                next_retry_at: null,
              } as never)
              .eq("id", d.id);
            failed++;
            bump(d.company_id, "failed");
            continue;
          }

          if (!endpoint.is_active) {
            // Endpoint paused — leave pending, push retry out by 1h.
            await admin
              .from("webhook_deliveries")
              .update({
                next_retry_at: new Date(Date.now() + 60 * 60_000).toISOString(),
              } as never)
              .eq("id", d.id);
            bump(d.company_id, "skipped");
            continue;
          }

          const rawBody = JSON.stringify(d.payload ?? {});
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const signature = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
          const attempts = d.attempts + 1;

          let responseStatus: number | null = null;
          let responseBody: string | null = null;
          let ok = false;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          try {
            const res = await fetch(endpoint.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "user-agent": "GridMind-Webhooks/1.0",
                "x-gridmind-event": d.event,
                "x-gridmind-delivery": d.id,
                "x-gridmind-timestamp": timestamp,
                "x-gridmind-signature": `sha256=${signature}`,
              },
              body: rawBody,
              signal: controller.signal,
            });
            responseStatus = res.status;
            const text = await res.text().catch(() => "");
            responseBody = text.length > RESPONSE_BODY_CAP
              ? text.slice(0, RESPONSE_BODY_CAP)
              : text;
            ok = res.status >= 200 && res.status < 300;
          } catch (err) {
            responseBody = `fetch_error: ${err instanceof Error ? err.message : String(err)}`.slice(
              0,
              RESPONSE_BODY_CAP,
            );
          } finally {
            clearTimeout(timer);
          }

          if (ok) {
            await admin
              .from("webhook_deliveries")
              .update({
                status: "success" as const,
                attempts,
                response_status: responseStatus,
                response_body: responseBody,
                delivered_at: new Date().toISOString(),
                next_retry_at: null,
              } as never)
              .eq("id", d.id);
            success++;
            bump(d.company_id, "success");
          } else if (attempts >= MAX_ATTEMPTS) {
            await admin
              .from("webhook_deliveries")
              .update({
                status: "failed" as const,
                attempts,
                response_status: responseStatus,
                response_body: responseBody,
                next_retry_at: null,
              } as never)
              .eq("id", d.id);
            failed++;
            bump(d.company_id, "failed");
          } else {
            const backoffMs = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
            await admin
              .from("webhook_deliveries")
              .update({
                status: "pending" as const,
                attempts,
                response_status: responseStatus,
                response_body: responseBody,
                next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
              } as never)
              .eq("id", d.id);
            retried++;
            bump(d.company_id, "retried");
          }
        }

        // Summary audit — one row per affected company.
        for (const [companyId, counts] of perCompany) {
          await admin.from("audit_logs").insert({
            company_id: companyId,
            actor_id: null,
            action: "cron.webhook_dispatch",
            entity: "cron",
            entity_id: null,
            metadata: { route: ROUTE, ...counts },
          } as never);
        }

        return Response.json({
          processed: deliveries.length,
          success,
          failed,
          retried,
        });
      },
    },
  },
});
