/**
 * P-126 — Inbound e-signature webhook.
 *
 * Third-party callers verify via `verifyWebhook` in the provider adapter
 * (HMAC-SHA256 over the raw body + timestamp, or manual dev token).
 * IP allowlist + rate limit come from the shared inbound-guard. We NEVER
 * call requireSupabaseAuth and NEVER read x-forwarded-for.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { auditGuardEvent } from "@/lib/public-api/guard";
import {
  enforceMode,
  inboundGate,
  jsonResponse,
} from "@/lib/public-api/inbound-guard";
import { verifyWebhook } from "@/lib/esign/provider";

const ROUTE = "webhooks:esign";

const payloadSchema = z.object({
  envelope_id: z.string().min(1),
  event: z.enum(["sent", "viewed", "completed", "declined", "voided"]),
  provider_event_id: z.string().min(1).optional(),
});

export const Route = createFileRoute("/api/webhooks/esign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Read raw body ONCE — verification must be over exact bytes.
        const rawBody = await request.text();
        const admin = createServiceRoleClient();
        const mode = enforceMode();

        // Provider verification (replaces guard stages 1 + 3).
        const verify = await verifyWebhook(request, rawBody);
        if (!verify.ok) {
          if (verify.reason === "not_configured") {
            return jsonResponse(503, {
              error: "webhook_not_configured",
              message: "ESIGN_WEBHOOK_SECRET missing",
            });
          }
          if (mode === "block") {
            await auditGuardEvent(admin, {
              companyId: null,
              action: "public_hook.signature_failed",
              route: ROUTE,
              reason: verify.reason,
              metadata: { provider: verify.providerName },
            });
            return jsonResponse(401, {
              error: verify.reason,
              message: "invalid signature",
            });
          }
          await auditGuardEvent(admin, {
            companyId: null,
            action: "public_hook.signature_failed",
            route: ROUTE,
            reason: verify.reason,
            metadata: { provider: verify.providerName, enforce: "warn" },
          });
        }

        // Stages 2 + 4.
        const gate = await inboundGate(request, {
          route: ROUTE,
          allowlistEnv: "ESIGN_ALLOWED_IPS",
          rateCapacity: 120,
          rateRefillPerSec: 2,
        });
        if (gate.block) return gate.block;

        let json: unknown;
        try {
          json = JSON.parse(rawBody);
        } catch {
          return jsonResponse(400, { error: "invalid_payload", message: "bad json" });
        }
        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return jsonResponse(400, {
            error: "invalid_payload",
            message: parsed.error.message,
          });
        }
        const { envelope_id, event, provider_event_id } = parsed.data;

        const { data: prop, error } = await admin
          .from("proposals")
          .select("id, company_id")
          .eq("esign_envelope_id", envelope_id)
          .maybeSingle();
        if (error) {
          return jsonResponse(500, { error: "db_error", message: error.message });
        }
        if (!prop) {
          return jsonResponse(404, {
            error: "unknown_envelope",
            message: "envelope not found",
          });
        }

        const { applyEsignEventInternal } = await import(
          "@/lib/proposal.functions"
        );
        try {
          await applyEsignEventInternal(
            admin,
            (prop as { id: string }).id,
            event,
            null,
            provider_event_id ?? null,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "apply_failed";
          return jsonResponse(500, { error: "apply_failed", message });
        }

        await auditGuardEvent(admin, {
          companyId: (prop as { company_id: string | null }).company_id ?? null,
          action: "esign.webhook_received",
          route: ROUTE,
          metadata: { event, envelope_id, provider: verify.providerName },
        });

        return jsonResponse(200, { ok: true });
      },
    },
  },
});
