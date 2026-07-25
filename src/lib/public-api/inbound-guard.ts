/**
 * P-126 — Stage 2 (IP allowlist via cf-connecting-ip only) + Stage 4 (rate
 * limit) shared across inbound third-party webhook routes. Provider-specific
 * verification (P-121 stages 1 + 3) is handled by each route's adapter.
 *
 * Auth is provider signature — we NEVER read x-forwarded-for.
 */
import { createServiceRoleClient } from "@/integrations/supabase/admin";
import {
  auditGuardEvent,
  ipMatchesAllowlist,
} from "@/lib/public-api/guard";

export function enforceMode(): "warn" | "block" {
  const raw =
    (typeof process !== "undefined" ? process.env?.PUBLIC_HOOK_ENFORCE : undefined) ??
    "block";
  return raw.toLowerCase() === "warn" ? "warn" : "block";
}

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

/** Parse comma-separated env allowlist. Empty/undef → null (no restriction). */
export function parseAllowlistEnv(name: string): string[] | null {
  const raw = process.env[name];
  if (!raw) return null;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export interface InboundGateOptions {
  route: string;
  /** Env var name holding a CIDR/IPv4 allowlist. Missing/empty ⇒ allow all. */
  allowlistEnv?: string;
  /** Token-bucket capacity. Default 120. */
  rateCapacity?: number;
  /** Token-bucket refill per second. Default 2. */
  rateRefillPerSec?: number;
}

export interface InboundGateResult {
  clientIp: string | null;
  /** If non-null, caller MUST return this Response immediately. */
  block: Response | null;
}

/**
 * Runs stages 2 + 4. `stage 2` obeys PUBLIC_HOOK_ENFORCE (warn continues, block
 * returns 403). `stage 4` always blocks with 429 + Retry-After. On rate-limit
 * RPC failure, fail open with an audit warn.
 */
export async function inboundGate(
  request: Request,
  opts: InboundGateOptions,
): Promise<InboundGateResult> {
  const admin = createServiceRoleClient();
  const mode = enforceMode();
  const clientIp = request.headers.get("cf-connecting-ip");

  // Stage 2 — IP allowlist (warn/block)
  if (opts.allowlistEnv) {
    const allowlist = parseAllowlistEnv(opts.allowlistEnv);
    if (allowlist && !ipMatchesAllowlist(clientIp, allowlist)) {
      if (mode === "block") {
        await auditGuardEvent(admin, {
          companyId: null,
          action: "public_hook.block",
          route: opts.route,
          reason: "ip_not_allowed",
          metadata: { client_ip: clientIp },
        });
        return {
          clientIp,
          block: jsonResponse(403, { error: "forbidden", message: "ip not allowed" }),
        };
      }
      await auditGuardEvent(admin, {
        companyId: null,
        action: "public_hook.warn",
        route: opts.route,
        reason: "ip_not_allowed",
        metadata: { client_ip: clientIp },
      });
    }
  }

  // Stage 4 — rate limit (always blocks; fail open on RPC error)
  const capacity = opts.rateCapacity ?? 120;
  const refill = opts.rateRefillPerSec ?? 2;
  const rateKey = `public_hook:inbound:${opts.route}:${clientIp ?? "unknown"}`;
  const { data: allowed, error: rateErr } = await admin.rpc("consume_rate_limit", {
    p_key: rateKey,
    p_capacity: capacity,
    p_refill_per_sec: refill,
  });
  if (rateErr) {
    // Fail open — log via audit warn so we can spot outages.
    await auditGuardEvent(admin, {
      companyId: null,
      action: "public_hook.warn",
      route: opts.route,
      reason: "rate_limit_error",
      metadata: { error: rateErr.message },
    });
    return { clientIp, block: null };
  }
  if (allowed !== true) {
    await auditGuardEvent(admin, {
      companyId: null,
      action: "public_hook.block",
      route: opts.route,
      reason: "rate_limited",
      metadata: { client_ip: clientIp },
    });
    return {
      clientIp,
      block: jsonResponse(
        429,
        { error: "rate_limited", message: "too many requests" },
        { "retry-after": String(Math.max(1, Math.ceil(1 / refill))) },
      ),
    };
  }

  return { clientIp, block: null };
}
