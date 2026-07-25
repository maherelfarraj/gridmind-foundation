// P-130 — Rate-limit wrapper inside guardPublicHook.
//   * allowed=false → 429 with Retry-After header
//   * RPC throw    → fail OPEN, emit public_hook.rate_limit_fail_open audit
// Fully offline, no Supabase.
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpcMock = vi.fn();
const auditInsertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/admin", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (_t: string) => ({ insert: (row: unknown) => auditInsertMock(row) }),
  }),
  admin: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (_t: string) => ({ insert: (row: unknown) => auditInsertMock(row) }),
  }),
}));

import { guardPublicHook, hmacSha256Hex } from "@/lib/public-api/guard";

const KEY_ROW = {
  key_id: "kkkkkkkk-kkkk-kkkk-kkkk-kkkkkkkkkkkk",
  company_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  scopes: ["scada:telemetry:write"],
  allowed_ips: ["10.0.0.0/8"],
  hmac_secret: "rl-secret",
};

async function signedReq(body = "{}") {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await hmacSha256Hex(KEY_ROW.hmac_secret, `${ts}.${body}`);
  return new Request("https://x.test/api/public/hooks/rate-test", {
    method: "POST",
    headers: {
      authorization: "Bearer raw-key",
      "content-type": "application/json",
      "cf-connecting-ip": "10.1.2.3",
      "x-timestamp": ts,
      "x-signature": sig,
    },
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

describe("rate-limit: consume_rate_limit returns false", () => {
  it("returns 429 with a Retry-After header", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "verify_api_key") return { data: [KEY_ROW], error: null };
      if (name === "consume_rate_limit") return { data: false, error: null };
      return { data: null, error: null };
    });
    const res = await guardPublicHook(await signedReq(), {
      scope: "scada:telemetry:write",
      route: "rate-test",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(429);
      expect(res.response.headers.get("retry-after")).toBeTruthy();
      const body = await res.response.json();
      expect(body.error).toBe("rate_limited");
    }
  });
});

describe("rate-limit: RPC throws → fail OPEN", () => {
  it("allows the request through and emits public_hook.rate_limit_fail_open", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "verify_api_key") return { data: [KEY_ROW], error: null };
      if (name === "consume_rate_limit") {
        return { data: null, error: { message: "connection refused" } };
      }
      return { data: null, error: null };
    });
    const res = await guardPublicHook(await signedReq(), {
      scope: "scada:telemetry:write",
      route: "rate-test",
    });
    expect(res.ok).toBe(true);

    const failOpenCall = auditInsertMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "public_hook.rate_limit_fail_open",
    );
    expect(failOpenCall, "expected fail-open audit event").toBeTruthy();
    const payload = failOpenCall![0] as {
      action: string;
      metadata: { route: string; reason: string; error: string };
    };
    expect(payload.metadata.route).toBe("rate-test");
    expect(payload.metadata.reason).toBe("rate_limiter_unavailable");
    expect(payload.metadata.error).toContain("connection refused");
  });

  it("fail-open also applies to the cron caller path", async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "cron-key-42";
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "consume_rate_limit") {
        return { data: null, error: { message: "timeout" } };
      }
      return { data: null, error: null };
    });
    const req = new Request("https://x.test/api/public/hooks/rate-test", {
      method: "POST",
      headers: { apikey: "cron-key-42", "content-type": "application/json" },
      body: "{}",
    });
    const res = await guardPublicHook(req, {
      route: "rate-test",
      allowCron: true,
    });
    delete process.env.SUPABASE_PUBLISHABLE_KEY;

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.caller.kind).toBe("cron");
    const failOpen = auditInsertMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "public_hook.rate_limit_fail_open",
    );
    expect(failOpen).toBeTruthy();
  });
});
