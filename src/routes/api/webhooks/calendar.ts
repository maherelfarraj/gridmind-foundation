/**
 * P-126 — Inbound calendar push webhook (Google-Calendar-style).
 *
 * Provider verification: header `x-goog-channel-token` == CALENDAR_WEBHOOK_SECRET
 * (timing-safe compare). Missing `integration_connections` table (42P01) yields
 * a graceful 200 { skipped: true }. Never calls requireSupabaseAuth; never
 * reads x-forwarded-for.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createServiceRoleClient } from "@/integrations/supabase/admin";
import {
  auditGuardEvent,
  timingSafeEqual,
} from "@/lib/public-api/guard";
import {
  enforceMode,
  inboundGate,
  jsonResponse,
} from "@/lib/public-api/inbound-guard";

const ROUTE = "webhooks:calendar";

function verifyChannelToken(request: Request): {
  ok: boolean;
  reason?: "not_configured" | "token_missing" | "token_mismatch";
} {
  const secret = process.env.CALENDAR_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "not_configured" };
  const provided = request.headers.get("x-goog-channel-token") ?? "";
  if (!provided) return { ok: false, reason: "token_missing" };
  if (provided.length === secret.length && timingSafeEqual(provided, secret)) {
    return { ok: true };
  }
  return { ok: false, reason: "token_mismatch" };
}

export const Route = createFileRoute("/api/webhooks/calendar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Google push often has empty body — read once anyway to preserve bytes.
        const rawBody = await request.text();
        void rawBody;
        const admin = createServiceRoleClient();
        const mode = enforceMode();

        const v = verifyChannelToken(request);
        if (!v.ok) {
          if (v.reason === "not_configured") {
            return jsonResponse(503, {
              error: "webhook_not_configured",
              message: "CALENDAR_WEBHOOK_SECRET missing",
            });
          }
          if (mode === "block") {
            await auditGuardEvent(admin, {
              companyId: null,
              action: "public_hook.signature_failed",
              route: ROUTE,
              reason: v.reason ?? "token_mismatch",
            });
            return jsonResponse(401, {
              error: v.reason ?? "token_mismatch",
              message: "invalid channel token",
            });
          }
          await auditGuardEvent(admin, {
            companyId: null,
            action: "public_hook.signature_failed",
            route: ROUTE,
            reason: v.reason ?? "token_mismatch",
            metadata: { enforce: "warn" },
          });
        }

        const gate = await inboundGate(request, {
          route: ROUTE,
          allowlistEnv: "CALENDAR_ALLOWED_IPS",
          rateCapacity: 120,
          rateRefillPerSec: 2,
        });
        if (gate.block) return gate.block;

        const channelId = request.headers.get("x-goog-channel-id") ?? "";
        const resourceState = request.headers.get("x-goog-resource-state") ?? "";
        const resourceId = request.headers.get("x-goog-resource-id") ?? "";

        // `sync` = channel handshake — ack only, no side effects.
        if (resourceState === "sync") {
          return jsonResponse(200, { ok: true, state: "sync" });
        }

        // Look up the channel binding. Table may not exist yet.
        let mapping: { company_id: string | null; project_id: string | null } | null = null;
        try {
          const { data, error } = await admin
            .from("integration_connections" as unknown as never)
            .select("company_id, project_id")
            .eq("channel_id", channelId)
            .maybeSingle();
          if (error) {
            const code = (error as { code?: string }).code ?? "";
            if (code === "42P01" || code === "PGRST205") {
              return jsonResponse(200, { skipped: true, reason: "table_missing" });
            }
            return jsonResponse(500, { error: "db_error", message: error.message });
          }
          mapping = (data as typeof mapping) ?? null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/does not exist|42P01|PGRST205/i.test(message)) {
            return jsonResponse(200, { skipped: true, reason: "table_missing" });
          }
          return jsonResponse(500, { error: "db_error", message });
        }

        if (!mapping) {
          return jsonResponse(200, { skipped: true, reason: "channel_unknown" });
        }

        if (resourceState === "exists") {
          // TODO(B14): enqueue a full schedule sync for the mapped project.
          if (mapping.company_id) {
            try {
              await admin.from("notifications").insert({
                company_id: mapping.company_id,
                user_id: null,
                kind: "calendar_update",
                title: "Calendar updated",
                body: "External calendar reported changes — schedule sync pending.",
                metadata: {
                  channel_id: channelId,
                  resource_id: resourceId,
                  project_id: mapping.project_id,
                },
              });
            } catch {
              /* notifications is best-effort */
            }
          }
          await auditGuardEvent(admin, {
            companyId: mapping.company_id,
            action: "calendar.webhook_received",
            route: ROUTE,
            metadata: {
              channel_id: channelId,
              resource_state: resourceState,
              resource_id: resourceId,
              project_id: mapping.project_id,
            },
          });
        }

        return jsonResponse(200, { ok: true, state: resourceState || "unknown" });
      },
    },
  },
});
