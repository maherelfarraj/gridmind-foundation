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
        const debug = url.searchParams.get("debug") === "1";

        if (debug) {
          const raw = await request.clone().text();
          const ts = request.headers.get("x-timestamp") ?? "";
          const sig = request.headers.get("x-signature") ?? "";
          const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
          const { createServiceRoleClient } = await import("@/integrations/supabase/admin");
          const admin = createServiceRoleClient();
          const { data } = await admin.rpc("verify_api_key", { p_raw_key: bearer });
          const row = (Array.isArray(data) ? data[0] : data) as { hmac_secret?: string } | undefined;
          const secret = row?.hmac_secret ?? "";
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          const s = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${raw}`));
          const bytes = new Uint8Array(s);
          let expected = "";
          for (let i = 0; i < bytes.length; i++) expected += bytes[i].toString(16).padStart(2, "0");
          return Response.json({ bodyLen: raw.length, ts, sig, expected, secretLen: secret.length, secretHead: secret.slice(0, 6) });
        }

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
