/**
 * P-121 — guardPublicHook: 4-stage security chain for /api/public/* endpoints.
 *
 *   1. Auth       — Bearer API key + scope check via verify_api_key RPC.
 *   2. IP allowlist — matches request against api_keys.allowed_ips (CIDR IPv4).
 *                     Source IP comes from `cf-connecting-ip` ONLY. We never
 *                     read `x-forwarded-for` — it is spoofable.
 *   3. HMAC       — x-timestamp within ±300s and x-signature = HMAC-SHA256
 *                   of `${timestamp}.${rawBody}` using api_keys.hmac_secret.
 *                   Timing-safe compare.
 *   4. Rate limit — consume_rate_limit RPC per key + route.
 *
 * Auth and rate-limit failures ALWAYS block. IP allowlist and HMAC honor
 * PUBLIC_HOOK_ENFORCE:
 *   - "block" (default) → 401/403 response on failure
 *   - "warn"            → allow through, but audit as `public_hook.warn`
 */
import { createServiceRoleClient } from "@/integrations/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface GuardOptions {
  /** Required scope on the api_key. Omit for cron-only routes where the
   *  caller is authenticated via the Supabase `apikey` header instead. */
  scope?: string;
  /** Logical route id used for rate-limit bucket keys + audit metadata. */
  route: string;
  /** Require HMAC signature verification. Defaults to false. */
  requireSignature?: boolean;
  /** Token-bucket capacity. Default 120. */
  rateCapacity?: number;
  /** Token-bucket refill per second. Default 2. */
  rateRefillPerSec?: number;
  /** Optional raw request body (string). If omitted, guard will read it. */
  rawBody?: string;
  /** Accept the Supabase `apikey` header as an alternative caller (pg_cron).
   *  When enabled and no Bearer is present, guard matches `apikey` against
   *  SUPABASE_PUBLISHABLE_KEY or CRON_APIKEY. Cron callers skip IP/HMAC/
   *  scope checks; rate limit still applies. */
  allowCron?: boolean;
}

export interface GuardCaller {
  kind: "api_key" | "cron";
  companyId: string | null;
  keyId: string | null;
}

export interface GuardSuccess {
  ok: true;
  /** @deprecated use caller.keyId */
  keyId: string | null;
  /** @deprecated use caller.companyId */
  companyId: string | null;
  scopes: string[];
  rawBody: string;
  clientIp: string | null;
  caller: GuardCaller;
  /** Warn-mode reasons that would have blocked under enforce=block.
   *  Endpoints should surface these via an `x-guard-warn` response header. */
  warnings: string[];
  /** Current enforcement mode at guard evaluation time. */
  mode: "warn" | "block";
}

export interface GuardFailure {
  ok: false;
  response: Response;
}

export type GuardResult = GuardSuccess | GuardFailure;

interface ApiKeyRow {
  key_id: string;
  company_id: string;
  scopes: string[] | null;
  allowed_ips: string[] | null;
  hmac_secret: string | null;
}

// --------------------------------------------------------------------------
// Public helpers (exported for tests)
// --------------------------------------------------------------------------

/** Constant-time compare of two equal-length byte strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 hex digest using Web Crypto (Worker-compatible). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** IPv4 dotted-quad → unsigned 32-bit integer. Returns null on invalid. */
export function ipv4ToLong(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/**
 * Test whether `ip` matches any entry in `allowlist`. Entries may be:
 *   - "1.2.3.4"        exact IPv4
 *   - "1.2.3.0/24"     IPv4 CIDR
 *   - "*"              wildcard (any IP passes)
 * Empty or null allowlist means "no restriction" → returns true.
 */
export function ipMatchesAllowlist(ip: string | null, allowlist: string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (allowlist.includes("*")) return true;
  if (!ip) return false;
  const ipLong = ipv4ToLong(ip);
  if (ipLong === null) return false;
  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
      const other = ipv4ToLong(trimmed);
      if (other !== null && other === ipLong) return true;
      continue;
    }
    const base = ipv4ToLong(trimmed.slice(0, slash));
    const bits = Number(trimmed.slice(slash + 1));
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    if (bits === 0) return true;
    const mask = (~0 << (32 - bits)) >>> 0;
    if ((ipLong & mask) === (base & mask)) return true;
  }
  return false;
}

/** Fire-and-forget audit write. Never throws. */
export async function auditGuardEvent(
  client: SupabaseClient,
  args: {
    companyId: string | null;
    action: string;
    keyId?: string | null;
    route: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await client.from("audit_logs").insert({
      company_id: args.companyId,
      actor_id: null,
      action: args.action,
      entity: "public_hook",
      entity_id: null,
      metadata: {
        route: args.route,
        key_id: args.keyId ?? null,
        reason: args.reason ?? null,
        ...(args.metadata ?? {}),
      },
    });
  } catch {
    /* audit write is best-effort */
  }
}

// --------------------------------------------------------------------------
// Guard
// --------------------------------------------------------------------------

const REPLAY_WINDOW_SECONDS = 300;

function jsonError(
  status: number,
  code: string,
  message?: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: code, message: message ?? code }), {
    status,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function enforceMode(): "warn" | "block" {
  const raw =
    (typeof process !== "undefined" ? process.env?.PUBLIC_HOOK_ENFORCE : undefined) ?? "block";
  return raw.toLowerCase() === "warn" ? "warn" : "block";
}

function matchCronApikey(header: string | null): boolean {
  if (!header) return false;
  const provided = header.trim();
  if (!provided) return false;
  const env = typeof process !== "undefined" ? process.env : undefined;
  const candidates = [env?.SUPABASE_PUBLISHABLE_KEY, env?.CRON_APIKEY].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  for (const expected of candidates) {
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

export async function guardPublicHook(request: Request, opts: GuardOptions): Promise<GuardResult> {
  const admin = createServiceRoleClient();
  const mode = enforceMode();
  const warnings: string[] = [];
  const clientIp = request.headers.get("cf-connecting-ip");

  // ---- Stage 1: auth (always blocks) -------------------------------------
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim())?.[1]?.trim();

  // ---- Cron caller branch (apikey header, no Bearer) ---------------------
  if (!bearer && opts.allowCron && matchCronApikey(request.headers.get("apikey"))) {
    const rawBody = opts.rawBody ?? (await request.clone().text());

    // Rate limit (bucket keyed by route, shared across all cron hits).
    const capacity = opts.rateCapacity ?? 120;
    const refill = opts.rateRefillPerSec ?? 2;
    const rateKey = `public_hook:cron:${opts.route}`;
    const { data: allowed, error: rateErr } = await admin.rpc("consume_rate_limit", {
      p_key: rateKey,
      p_capacity: capacity,
      p_refill_per_sec: refill,
    });
    if (rateErr) {
      // Fail OPEN on rate limiter unavailability. Emit structured audit so
      // ops can spot systemic RPC failures without an outage from this hook.
      await auditGuardEvent(admin, {
        companyId: null,
        action: "public_hook.rate_limit_fail_open",
        route: opts.route,
        reason: "rate_limiter_unavailable",
        metadata: { error: String((rateErr as { message?: string })?.message ?? rateErr) },
      });
      return {
        ok: true,
        keyId: null,
        companyId: null,
        scopes: [],
        rawBody,
        clientIp,
        caller: { kind: "cron", companyId: null, keyId: null },
        warnings,
        mode,
      };
    }
    if (allowed !== true) {
      await auditGuardEvent(admin, {
        companyId: null,
        action: "public_hook.block",
        route: opts.route,
        reason: "rate_limited",
      });
      return {
        ok: false,
        response: jsonError(429, "rate_limited", "too many requests", {
          "retry-after": String(Math.max(1, Math.ceil(1 / refill))),
        }),
      };
    }

    return {
      ok: true,
      keyId: null,
      companyId: null,
      scopes: [],
      rawBody,
      clientIp,
      caller: { kind: "cron", companyId: null, keyId: null },
      warnings,
      mode,
    };
  }

  if (!bearer) {
    await auditGuardEvent(admin, {
      companyId: null,
      action: "public_hook.block",
      route: opts.route,
      reason: "missing_bearer",
    });
    return { ok: false, response: jsonError(401, "unauthorized", "missing bearer token") };
  }

  const { data: verifyRows, error: verifyErr } = await admin.rpc("verify_api_key", {
    p_raw_key: bearer,
  });
  if (verifyErr) {
    return { ok: false, response: jsonError(401, "unauthorized", "key verification failed") };
  }
  const keyRow = (Array.isArray(verifyRows) ? verifyRows[0] : verifyRows) as ApiKeyRow | undefined;
  if (!keyRow) {
    await auditGuardEvent(admin, {
      companyId: null,
      action: "public_hook.block",
      route: opts.route,
      reason: "invalid_key",
    });
    return { ok: false, response: jsonError(401, "unauthorized", "invalid key") };
  }

  const scopes = keyRow.scopes ?? [];
  if (opts.scope && !scopes.includes(opts.scope)) {
    await auditGuardEvent(admin, {
      companyId: keyRow.company_id,
      keyId: keyRow.key_id,
      action: "public_hook.block",
      route: opts.route,
      reason: "scope_missing",
      metadata: { required_scope: opts.scope },
    });
    return { ok: false, response: jsonError(403, "forbidden", "missing required scope") };
  }

  // ---- Stage 2: IP allowlist (warn/block) --------------------------------
  const ipOk = ipMatchesAllowlist(clientIp, keyRow.allowed_ips);
  if (!ipOk) {
    if (mode === "block") {
      await auditGuardEvent(admin, {
        companyId: keyRow.company_id,
        keyId: keyRow.key_id,
        action: "public_hook.block",
        route: opts.route,
        reason: "ip_not_allowed",
        metadata: { client_ip: clientIp },
      });
      return { ok: false, response: jsonError(403, "forbidden", "ip not allowed") };
    }
    await auditGuardEvent(admin, {
      companyId: keyRow.company_id,
      keyId: keyRow.key_id,
      action: "public_hook.warn",
      route: opts.route,
      reason: "ip_not_allowed",
      metadata: { client_ip: clientIp },
    });
    warnings.push("ip_not_allowed");
  }

  // ---- Stage 3: HMAC signature (warn/block) ------------------------------
  const rawBody = opts.rawBody ?? (await request.clone().text());
  if (opts.requireSignature || keyRow.hmac_secret) {
    const secret = keyRow.hmac_secret;
    const tsHeader = request.headers.get("x-timestamp");
    const sigHeader = request.headers.get("x-signature");
    let sigOk = false;
    let sigReason = "signature_missing";

    if (!secret) {
      sigReason = "secret_not_configured";
    } else if (!tsHeader || !sigHeader) {
      sigReason = "signature_missing";
    } else {
      const ts = Number(tsHeader);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > REPLAY_WINDOW_SECONDS) {
        sigReason = "signature_expired";
      } else {
        const expected = await hmacSha256Hex(secret, `${tsHeader}.${rawBody}`);
        const provided = sigHeader.toLowerCase().replace(/^sha256=/, "");
        if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
          sigOk = true;
        } else {
          sigReason = "signature_mismatch";
        }
      }
    }

    if (!sigOk) {
      if (mode === "block") {
        await auditGuardEvent(admin, {
          companyId: keyRow.company_id,
          keyId: keyRow.key_id,
          action: "public_hook.block",
          route: opts.route,
          reason: sigReason,
        });
        return { ok: false, response: jsonError(401, sigReason, "invalid signature") };
      }
      await auditGuardEvent(admin, {
        companyId: keyRow.company_id,
        keyId: keyRow.key_id,
        action: "public_hook.warn",
        route: opts.route,
        reason: sigReason,
      });
      warnings.push(sigReason);
    }
  }

  // ---- Stage 4: rate limit (always blocks) -------------------------------
  const capacity = opts.rateCapacity ?? 120;
  const refill = opts.rateRefillPerSec ?? 2;
  const rateKey = `public_hook:${keyRow.key_id}:${opts.route}`;
  const { data: allowed, error: rateErr } = await admin.rpc("consume_rate_limit", {
    p_key: rateKey,
    p_capacity: capacity,
    p_refill_per_sec: refill,
  });
  if (rateErr) {
    // Fail OPEN on rate limiter unavailability. Emit structured audit so ops
    // can spot systemic RPC failures without an outage from this hook.
    await auditGuardEvent(admin, {
      companyId: keyRow.company_id,
      keyId: keyRow.key_id,
      action: "public_hook.rate_limit_fail_open",
      route: opts.route,
      reason: "rate_limiter_unavailable",
      metadata: { error: String((rateErr as { message?: string })?.message ?? rateErr) },
    });
    return {
      ok: true,
      keyId: keyRow.key_id,
      companyId: keyRow.company_id,
      scopes,
      rawBody,
      clientIp,
      caller: { kind: "api_key", companyId: keyRow.company_id, keyId: keyRow.key_id },
      warnings,
      mode,
    };
  }
  if (allowed !== true) {
    await auditGuardEvent(admin, {
      companyId: keyRow.company_id,
      keyId: keyRow.key_id,
      action: "public_hook.block",
      route: opts.route,
      reason: "rate_limited",
    });
    return {
      ok: false,
      response: jsonError(429, "rate_limited", "too many requests", {
        "retry-after": String(Math.max(1, Math.ceil(1 / refill))),
      }),
    };
  }

  return {
    ok: true,
    keyId: keyRow.key_id,
    companyId: keyRow.company_id,
    scopes,
    rawBody,
    clientIp,
    caller: { kind: "api_key", companyId: keyRow.company_id, keyId: keyRow.key_id },
    warnings,
    mode,
  };
}
