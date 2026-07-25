// P-122 — Ping hook. requireSignature: true, no DB writes. Integrators use
// this to validate their HMAC signing recipe against the docs (P-127).
import { createFileRoute } from "@tanstack/react-router";

import { guardPublicHook } from "@/lib/public-api/guard";

const ENDPOINT = "hooks:ping";

export const Route = createFileRoute("/api/public/hooks/ping")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ENDPOINT,
          scope: "hooks:ping",
          requireSignature: true,
          rateCapacity: 60,
          rateRefillPerSec: 1,
        });
        if (!guard.ok) return guard.response;

        return Response.json({
          pong: true,
          caller: "api_key",
          companyId: guard.companyId,
        });
      },
    },
  },
});
