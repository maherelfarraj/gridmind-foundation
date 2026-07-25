// P-112 — Approval escalation cron stub.
// TODO(B13/P-123): wrap with guardPublicHook (IP allowlist + HMAC + rate limit).
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/cron/approval-escalations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_APIKEY;
        const provided = request.headers.get("apikey") ?? "";
        if (!expected) return unauthorized();
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return unauthorized();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("escalate_overdue_approvals");
        if (error) {
          return new Response(
            JSON.stringify({ error: "escalation_failed", message: error.message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        const escalated = typeof data === "number" ? data : 0;
        return new Response(JSON.stringify({ escalated }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
