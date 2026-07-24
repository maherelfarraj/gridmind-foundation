// P-049 — E-signature webhook.
//
// TODO(B13/P-126): move under /api/public/esign and wrap in guardPublicHook +
// full provider signature verification (HMAC per provider). Until then a
// shared-secret header check (ESIGN_WEBHOOK_SECRET, timing-safe) is the
// minimal auth gate. Never expose service-role or Supabase secrets here; the
// admin client is only loaded inside the handler after the caller is
// verified.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const payloadSchema = z.object({
  envelope_id: z.string().min(1),
  event: z.enum(["sent", "viewed", "completed", "declined", "voided"]),
  provider_event_id: z.string().min(1).optional(),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export const Route = createFileRoute("/api/webhooks/esign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ESIGN_WEBHOOK_SECRET;
        if (!expected) {
          return new Response("webhook_not_configured", { status: 503 });
        }
        const provided = request.headers.get("x-esign-signature") ?? "";
        if (!timingSafeEqual(provided, expected)) {
          return new Response("unauthorized", { status: 401 });
        }

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("bad_json", { status: 400 });
        }
        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return new Response("bad_payload", { status: 400 });
        }
        const { envelope_id, event, provider_event_id } = parsed.data;

        // Load supabaseAdmin only inside the handler; resolve proposal by envelope.
        const { createServiceRoleClient } = await import(
          "@/integrations/supabase/server"
        );
        const admin = createServiceRoleClient();
        const { data: prop, error } = await admin
          .from("proposals")
          .select("id")
          .eq("esign_envelope_id", envelope_id)
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });
        if (!prop) return new Response("envelope_not_found", { status: 404 });

        const { applyEsignEventInternal } = await import(
          "@/lib/proposal.functions"
        );
        try {
          await applyEsignEventInternal(
            admin,
            (prop as any).id,
            event,
            null,
            provider_event_id ?? null,
          );
        } catch (err: any) {
          return new Response(err?.message ?? "apply_failed", { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
