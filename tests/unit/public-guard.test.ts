// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- Mock the admin service-role client BEFORE importing the guard --------
const rpcMock = vi.fn();
const auditInsertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/admin", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (_table: string) => ({ insert: (row: unknown) => auditInsertMock(row) }),
  }),
  admin: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (_table: string) => ({ insert: (row: unknown) => auditInsertMock(row) }),
  }),
}));

import {
  guardPublicHook,
  hmacSha256Hex,
  ipMatchesAllowlist,
  ipv4ToLong,
  timingSafeEqual,
} from "@/lib/public-api/guard";

const KEY_ROW = {
  key_id: "11111111-1111-1111-1111-111111111111",
  company_id: "22222222-2222-2222-2222-222222222222",
  scopes: ["scada:telemetry:write"],
  allowed_ips: ["10.0.0.0/8"],
  hmac_secret: "shhh",
};

function setupRpc(
  overrides: {
    verify?: unknown;
    verifyError?: unknown;
    rate?: boolean;
    rateError?: unknown;
  } = {},
) {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "verify_api_key") {
      if ("verifyError" in overrides) return { data: null, error: overrides.verifyError };
      return { data: [overrides.verify ?? KEY_ROW], error: null };
    }
    if (name === "consume_rate_limit") {
      if ("rateError" in overrides) return { data: null, error: overrides.rateError };
      return { data: overrides.rate ?? true, error: null };
    }
    return { data: null, error: null };
  });
}

async function signedRequest(
  body: string,
  opts: {
    ts?: number;
    ip?: string | null;
    bearer?: string;
    secret?: string;
    withSignature?: boolean;
    sigOverride?: string;
  } = {},
) {
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const secret = opts.secret ?? KEY_ROW.hmac_secret;
  const sig = opts.sigOverride ?? (await hmacSha256Hex(secret, `${ts}.${body}`));
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.bearer ?? "raw-key"}`,
    "content-type": "application/json",
  };
  if (opts.ip !== null) headers["cf-connecting-ip"] = opts.ip ?? "10.1.2.3";
  if (opts.withSignature !== false) {
    headers["x-timestamp"] = ts;
    headers["x-signature"] = sig;
  }
  return new Request("https://x.test/api/public/hooks/test", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  auditInsertMock.mockClear();
  process.env.PUBLIC_HOOK_ENFORCE = "block";
});

afterEach(() => {
  delete process.env.PUBLIC_HOOK_ENFORCE;
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

describe("helpers", () => {
  it("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("ipv4ToLong", () => {
    expect(ipv4ToLong("0.0.0.0")).toBe(0);
    expect(ipv4ToLong("255.255.255.255")).toBe(0xffffffff);
    expect(ipv4ToLong("10.0.0.1")).toBe(10 * 2 ** 24 + 1);
    expect(ipv4ToLong("bogus")).toBeNull();
    expect(ipv4ToLong("1.2.3.999")).toBeNull();
  });

  it("ipMatchesAllowlist — empty allows all", () => {
    expect(ipMatchesAllowlist("1.2.3.4", [])).toBe(true);
    expect(ipMatchesAllowlist(null, null)).toBe(true);
  });

  it("ipMatchesAllowlist — exact + CIDR + wildcard", () => {
    expect(ipMatchesAllowlist("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(ipMatchesAllowlist("10.5.6.7", ["10.0.0.0/8"])).toBe(true);
    expect(ipMatchesAllowlist("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipMatchesAllowlist("9.9.9.9", ["*"])).toBe(true);
    expect(ipMatchesAllowlist(null, ["1.2.3.4"])).toBe(false);
  });

  it("hmacSha256Hex — RFC test vector", async () => {
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    const hex = await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog");
    expect(hex).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});

// --------------------------------------------------------------------------
// Guard chain
// --------------------------------------------------------------------------

describe("guardPublicHook", () => {
  const opts = { scope: "scada:telemetry:write", route: "scada/telemetry" };

  it("happy path returns ok with body + claims", async () => {
    setupRpc({});
    const req = await signedRequest('{"ping":1}');
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.companyId).toBe(KEY_ROW.company_id);
      expect(res.keyId).toBe(KEY_ROW.key_id);
      expect(res.rawBody).toBe('{"ping":1}');
    }
  });

  it("401 when bearer missing", async () => {
    setupRpc({});
    const req = new Request("https://x.test/api/public/hooks/test", { method: "POST" });
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("401 when verify_api_key returns null (invalid key)", async () => {
    setupRpc({ verify: undefined });
    rpcMock.mockImplementation(async (name) => {
      if (name === "verify_api_key") return { data: [], error: null };
      return { data: true, error: null };
    });
    const req = await signedRequest("{}");
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("403 when scope missing", async () => {
    setupRpc({ verify: { ...KEY_ROW, scopes: ["other:scope"] } });
    const req = await signedRequest("{}");
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("403 when IP not in allowlist (block mode)", async () => {
    setupRpc({});
    const req = await signedRequest("{}", { ip: "192.168.1.1" });
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("warns (allows) when IP wrong but enforce=warn", async () => {
    process.env.PUBLIC_HOOK_ENFORCE = "warn";
    setupRpc({});
    const req = await signedRequest("{}", { ip: "192.168.1.1" });
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(true);
    expect(auditInsertMock).toHaveBeenCalled();
    const call = auditInsertMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "public_hook.warn",
    );
    expect(call).toBeTruthy();
  });

  it("401 signature_expired on replayed old timestamp", async () => {
    setupRpc({});
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10min old > 300s
    const req = await signedRequest("{}", { ts: oldTs });
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(401);
      const body = await res.response.json();
      expect(body.error).toBe("signature_expired");
    }
  });

  it("401 signature_mismatch on tampered body", async () => {
    setupRpc({});
    const req = await signedRequest('{"a":1}', { sigOverride: "deadbeef".repeat(8) });
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("429 when rate limit exceeded (always blocks)", async () => {
    setupRpc({ rate: false });
    const req = await signedRequest("{}");
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(429);
  });

  it("rate-limit block is enforced even under enforce=warn", async () => {
    process.env.PUBLIC_HOOK_ENFORCE = "warn";
    setupRpc({ rate: false });
    const req = await signedRequest("{}");
    const res = await guardPublicHook(req, opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(429);
  });
});
