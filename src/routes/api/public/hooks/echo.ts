// P-131 — Echo hook. Test-only endpoint dedicated to the guard matrix.
//
// Contract:
//   POST /api/public/hooks/echo               — full guard, requireSignature
//   POST /api/public/hooks/echo?nosig=1       — guard without signature check
//   POST /api/public/hooks/echo?burst=1       — tiny bucket (capacity 3) for
//                                                deterministic 429 tests
//
// Uses scope `hooks:events` (already in the P-124 catalog). Returns 200 with
// a small caller-info body; never touches domain tables.
import { createFileRoute } from "@tanstack/react-router";

import { guardPublicHook } from "@/lib/public-api/guard";

const ENDPOINT = "hooks:echo";

export const Route = createFileRoute("/api/public/hooks/echo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const nosig = url.searchParams.get("nosig") === "1";
        const burst = url.searchParams.get("burst") === "1";

        const guard = await guardPublicHook(request, {
          route: ENDPOINT,
          scope: "hooks:events",
          requireSignature: !nosig,
          rateCapacity: burst ? 3 : 120,
          rateRefillPerSec: burst ? 0.001 : 2,
        });
        if (!guard.ok) return guard.response;

        return Response.json({
          echoed: true,
          caller: guard.caller.kind,
          companyId: guard.companyId,
          keyId: guard.keyId,
          bodyLen: guard.rawBody.length,
        });
      },
    },
  },
});
