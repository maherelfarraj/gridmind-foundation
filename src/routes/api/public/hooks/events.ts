// P-122 — Generic event hook. Low-risk canonical integration-test endpoint.
//
// Guard requires the `hooks:events` scope. HMAC signing is required only when
// PUBLIC_HOOK_SIGNING_SECRET is set (opt-out by default so integrators can
// start plain-bearer and add signing later). Every accepted call writes one
// audit_logs row (`public_hook.event_received`) with the event + data,
// truncated to 8 KB.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ENDPOINT = "hooks:events";
const MAX_DATA_BYTES = 8 * 1024;

const eventSchema = z.object({
  event: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9._-]+$/, "event must match [a-z0-9._-]"),
  data: z.record(z.string(), z.unknown()).default({}),
});

function signingRequired(): boolean {
  const raw = typeof process !== "undefined" ? process.env?.PUBLIC_HOOK_SIGNING_SECRET : undefined;
  return typeof raw === "string" && raw.length > 0;
}

export const Route = createFileRoute("/api/public/hooks/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ENDPOINT,
          scope: "hooks:events",
          requireSignature: signingRequired(),
        });
        if (!guard.ok) return guard.response;

        let json: unknown;
        try {
          json = JSON.parse(guard.rawBody);
        } catch {
          return Response.json({ error: "invalid_payload", reason: "bad_json" }, { status: 400 });
        }

        const parsed = eventSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_payload", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        // Cap the stored data blob at 8 KB. Anything larger is dropped and the
        // audit row is flagged with `truncated: true` so operators can spot
        // integrators sending oversize payloads without losing the event
        // signal itself.
        let storedData: unknown = parsed.data.data;
        let truncated = false;
        try {
          const encoded = JSON.stringify(parsed.data.data);
          if (encoded.length > MAX_DATA_BYTES) {
            storedData = { truncated_original_bytes: encoded.length };
            truncated = true;
          }
        } catch {
          storedData = { serialization_error: true };
          truncated = true;
        }

        const admin = createServiceRoleClient();
        await admin.from("audit_logs").insert({
          company_id: guard.companyId,
          actor_id: null,
          action: "public_hook.event_received",
          entity: "public_hook",
          entity_id: null,
          metadata: {
            endpoint: ENDPOINT,
            key_id: guard.keyId,
            event: parsed.data.event,
            data: storedData,
            truncated,
          },
        } as never);

        return Response.json({ received: true });
      },
    },
  },
});
