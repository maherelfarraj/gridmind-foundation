// P-131 — API guard attack matrix.
//
// Two layers:
//   (A) HTTP matrix against the running dev server. The server enforces
//       whatever PUBLIC_HOOK_ENFORCE it was started with (default: block).
//       These rows cover the "always-block" behaviors: auth, revocation,
//       cron path, cf-connecting-ip vs spoofed x-forwarded-for, HMAC
//       missing/tampered/replayed, and rate limit burst.
//   (B) In-process guard invocation with PUBLIC_HOOK_ENFORCE='warn'. This
//       covers the "warn mode" rows without needing to bounce the dev
//       server. The guard runs in this test process against the same
//       Supabase service-role client the server uses.
//
// Skip conditions: dev server unreachable OR service-role env absent
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). No fixtures leak — company +
// keys are deleted in afterAll; audit rows stay (append-only).
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isDevServerUp, DEV_SERVER_URL } from "../helpers/dev-server";
import { guardPublicHook } from "@/lib/public-api/guard";

// --------------------------------------------------------------------------
// Environment / capability detection
// --------------------------------------------------------------------------

const serverUp = await isDevServerUp();
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_APIKEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const canRunHttp = serverUp && !!SUPABASE_URL && !!SERVICE_ROLE_KEY;

// --------------------------------------------------------------------------
// Fixture types + helpers
// --------------------------------------------------------------------------

interface TestKey {
  id: string;
  raw: string;
  hmac: string;
}
interface Fixture {
  admin: SupabaseClient;
  companyId: string;
  companySlug: string;
  keyOpen: TestKey; // no IP allowlist
  keyPinned: TestKey; // allowed_ips = 198.51.100.7/32
}

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}
function hmacHex(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg).digest("hex");
}
function sign(secret: string, ts: string | number, body: string): string {
  return `sha256=${hmacHex(secret, `${ts}.${body}`)}`;
}
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function createFixture(): Promise<Fixture> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomBytes(4).toString("hex");
  const slug = `p131-${suffix}`;
  const { data: company, error: cErr } = await admin
    .from("companies")
    .insert({ name: `P-131 Fixture ${suffix}`, slug, plan_tier: "enterprise" })
    .select("id, slug")
    .single();
  if (cErr || !company) throw new Error(`fixture company: ${cErr?.message}`);

  async function mkKey(name: string, allowedIps: string[]): Promise<TestKey> {
    const raw = `gm_test_${randomBytes(24).toString("hex")}`;
    const hmac = randomBytes(24).toString("hex");
    const { data, error } = await admin
      .from("api_keys")
      .insert({
        company_id: company.id,
        name,
        key_prefix: raw.slice(0, 10),
        key_hash: sha256Hex(raw),
        scopes: ["hooks:events"],
        allowed_ips: allowedIps,
        hmac_secret: hmac,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture api_key: ${error?.message}`);
    return { id: data.id, raw, hmac };
  }

  const keyOpen = await mkKey("P-131 open", []);
  const keyPinned = await mkKey("P-131 pinned", ["198.51.100.7/32"]);
  return { admin, companyId: company.id, companySlug: slug, keyOpen, keyPinned };
}

async function cleanupFixture(f: Fixture): Promise<void> {
  await f.admin.from("api_keys").delete().eq("company_id", f.companyId);
  await f.admin.from("companies").delete().eq("id", f.companyId);
}

async function post(url: string, headers: Record<string, string>, body = "{}"): Promise<Response> {
  return fetch(url, { method: "POST", headers, body });
}

function signedHeaders(
  key: TestKey,
  body: string,
  overrides: Partial<{
    ts: number;
    bearer: string;
    cfIp: string;
    xff: string;
    withSig: boolean;
  }> = {},
): Record<string, string> {
  const ts = String(overrides.ts ?? nowSec());
  const bearer = overrides.bearer ?? key.raw;
  const h: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    "x-timestamp": ts,
  };
  if (overrides.withSig !== false) h["x-signature"] = sign(key.hmac, ts, body);
  if (overrides.cfIp !== undefined) h["cf-connecting-ip"] = overrides.cfIp;
  if (overrides.xff !== undefined) h["x-forwarded-for"] = overrides.xff;
  return h;
}

// --------------------------------------------------------------------------
// (A) HTTP matrix against the running dev server
// --------------------------------------------------------------------------

const ECHO_URL = `${DEV_SERVER_URL}/api/public/hooks/echo`;
const ECHO_NOSIG_URL = `${DEV_SERVER_URL}/api/public/hooks/echo?nosig=1`;
const ECHO_BURST_URL = `${DEV_SERVER_URL}/api/public/hooks/echo?burst=1`;
const CRON_URL = `${DEV_SERVER_URL}/api/public/cron/approval-escalations`;

const SERVER_MODE: "warn" | "block" =
  (process.env.PUBLIC_HOOK_ENFORCE ?? "block").toLowerCase() === "warn" ? "warn" : "block";

describe.skipIf(!canRunHttp)(`P-131 HTTP guard matrix (server enforce=${SERVER_MODE})`, () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await createFixture();
  });

  afterAll(async () => {
    if (fx) await cleanupFixture(fx);
  });

  // --- helpers scoped to this describe -----------------------------------
  async function auditWarnFor(keyId: string, reason: string): Promise<boolean> {
    // Poll: audit write is best-effort/fire-and-forget.
    for (let i = 0; i < 5; i++) {
      const { data } = await fx.admin
        .from("audit_logs")
        .select("action, metadata")
        .eq("company_id", fx.companyId)
        .in("action", ["public_hook.warn", "public_hook.block"])
        .order("created_at", { ascending: false })
        .limit(25);
      const hit = (data ?? []).find(
        (r) =>
          (r.metadata as { key_id?: string; reason?: string })?.key_id === keyId &&
          (r.metadata as { reason?: string })?.reason === reason,
      );
      if (hit) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  /** Assert 401/403 in block mode, or 200 + x-guard-warn header + audit row in warn mode. */
  async function expectBlockedOrWarned(
    res: Response,
    blockedStatus: 401 | 403,
    warnReason: string,
    keyId: string,
  ) {
    if (SERVER_MODE === "block") {
      expect(res.status).toBe(blockedStatus);
      return;
    }
    expect(res.status).toBe(200);
    const warnHeader = res.headers.get("x-guard-warn") ?? "";
    expect(warnHeader.split(",")).toContain(warnReason);
    expect(res.headers.get("x-guard-mode")).toBe("warn");
    expect(await auditWarnFor(keyId, warnReason)).toBe(true);
  }

  // Row 1: No Authorization header → 401 (auth always blocks, both modes).
  it("row 1: missing Authorization → 401 (invariant)", async () => {
    const body = "{}";
    const ts = String(nowSec());
    const res = await post(
      ECHO_URL,
      {
        "content-type": "application/json",
        "x-timestamp": ts,
        "x-signature": sign("anything", ts, body),
      },
      body,
    );
    expect(res.status).toBe(401);
  });

  // Row 2: Bearer with an unknown key → 401 (invariant).
  it("row 2: wrong bearer → 401 (invariant)", async () => {
    const body = "{}";
    const headers = signedHeaders(fx.keyOpen, body, { bearer: "gm_wrong_key_zzz" });
    const res = await post(ECHO_URL, headers, body);
    expect(res.status).toBe(401);
  });

  // Row 3a: Valid Bearer + signature → 200 (invariant).
  it("row 3a: valid key + signature → 200 (invariant)", async () => {
    const body = '{"probe":"ok"}';
    const res = await post(ECHO_URL, signedHeaders(fx.keyOpen, body), body);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { echoed: boolean; companyId: string };
    expect(j.echoed).toBe(true);
    expect(j.companyId).toBe(fx.companyId);
  });

  // Row 4: Revoked key → 401 (invariant — auth always blocks).
  it("row 4: revoked key → 401 (invariant)", async () => {
    const throwaway = `gm_test_${randomBytes(16).toString("hex")}`;
    const hmac = randomBytes(16).toString("hex");
    const { data } = await fx.admin
      .from("api_keys")
      .insert({
        company_id: fx.companyId,
        name: "P-131 revocable",
        key_prefix: throwaway.slice(0, 10),
        key_hash: sha256Hex(throwaway),
        scopes: ["hooks:events"],
        allowed_ips: [],
        hmac_secret: hmac,
      })
      .select("id")
      .single();
    const k: TestKey = { id: data!.id, raw: throwaway, hmac };
    const body = "{}";
    const ok = await post(ECHO_URL, signedHeaders(k, body), body);
    expect(ok.status).toBe(200);
    await fx.admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", k.id);
    const after = await post(ECHO_URL, signedHeaders(k, body), body);
    expect(after.status).toBe(401);
  });

  // Row 5: Cron path — apikey header, no Bearer → 200 (invariant).
  it("row 5: cron endpoint accepts Supabase apikey header without Bearer (invariant)", async () => {
    if (!SUPABASE_APIKEY) return;
    const res = await post(
      CRON_URL,
      { apikey: SUPABASE_APIKEY, "content-type": "application/json" },
      "{}",
    );
    expect([200, 202]).toContain(res.status);
  });

  // Row 6a: cf-connecting-ip authoritative; spoofed XFF ignored (invariant).
  it("row 6a: cf-connecting-ip allowed + spoofed XFF banned → 200 (invariant)", async () => {
    const body = "{}";
    const headers = signedHeaders(fx.keyPinned, body, {
      cfIp: "198.51.100.7",
      xff: "203.0.113.9",
    });
    const res = await post(ECHO_URL, headers, body);
    expect(res.status).toBe(200);
  });

  // Row 6b: XFF-only (spoof) must NEVER pass — 403 in block, 200+warn in warn.
  // Either way: proof the guard doesn't consult x-forwarded-for.
  it("row 6b: XFF-only (no cf-connecting-ip) spoofing allowlist → blocked or warned", async () => {
    const body = "{}";
    const headers = signedHeaders(fx.keyPinned, body, { xff: "198.51.100.7" });
    const res = await post(ECHO_URL, headers, body);
    await expectBlockedOrWarned(res, 403, "ip_not_allowed", fx.keyPinned.id);
  });

  // Row 7: Missing signature on requireSignature endpoint.
  it("row 7: missing x-signature on requireSignature route → blocked or warned", async () => {
    const body = "{}";
    const headers = signedHeaders(fx.keyOpen, body, { withSig: false });
    delete headers["x-timestamp"];
    const res = await post(ECHO_URL, headers, body);
    await expectBlockedOrWarned(res, 401, "signature_missing", fx.keyOpen.id);
  });

  // Row 8a: Replay window boundary — 300s exactly is ACCEPTED (invariant).
  it("row 8a: ts = now − 300 (boundary) → 200 (invariant)", async () => {
    const body = "{}";
    const ts = nowSec() - 300;
    const res = await post(ECHO_URL, signedHeaders(fx.keyOpen, body, { ts }), body);
    expect(res.status).toBe(200);
  });

  // Rows 8b/8c: past ±300s the guard MUST detect signature_expired.
  // In block: 401 signature_expired. In warn: 200 + x-guard-warn=signature_expired.
  it("row 8b: ts = now − 301 → signature_expired blocked-or-warned", async () => {
    const body = "{}";
    const ts = nowSec() - 301;
    const res = await post(ECHO_URL, signedHeaders(fx.keyOpen, body, { ts }), body);
    await expectBlockedOrWarned(res, 401, "signature_expired", fx.keyOpen.id);
    if (SERVER_MODE === "block") {
      const j = (await res.json()) as { error: string };
      expect(j.error).toBe("signature_expired");
    }
  });

  it("row 8c: ts = now + 301 → signature_expired blocked-or-warned", async () => {
    const body = "{}";
    const ts = nowSec() + 301;
    const res = await post(ECHO_URL, signedHeaders(fx.keyOpen, body, { ts }), body);
    await expectBlockedOrWarned(res, 401, "signature_expired", fx.keyOpen.id);
    if (SERVER_MODE === "block") {
      const j = (await res.json()) as { error: string };
      expect(j.error).toBe("signature_expired");
    }
  });

  // Row 9: Tampered body — signature over body A, actual bytes B.
  it("row 9: tampered body (valid ts, wrong sig) → blocked or warned", async () => {
    const body = '{"real":true}';
    const headers = signedHeaders(fx.keyOpen, body);
    const res = await post(ECHO_URL, headers, '{"real":false}');
    await expectBlockedOrWarned(res, 401, "signature_mismatch", fx.keyOpen.id);
  });

  // Row 10: Rate limit burst → 429 with numeric Retry-After (invariant).
  it("row 10: burst > capacity → 429 with numeric Retry-After (invariant)", async () => {
    const body = "{}";
    let last429: Response | null = null;
    let successes = 0;
    for (let i = 0; i < 10; i++) {
      const res = await post(ECHO_BURST_URL, signedHeaders(fx.keyOpen, body), body);
      if (res.status === 429) last429 = res;
      else if (res.status === 200) successes += 1;
    }
    expect(successes).toBeGreaterThanOrEqual(1);
    expect(last429, "expected at least one 429 in burst").not.toBeNull();
    const retryAfter = last429!.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// (B) In-process warn-mode assertions.
// --------------------------------------------------------------------------
//
// The guard is called directly with PUBLIC_HOOK_ENFORCE='warn' set on
// process.env for this vitest process. This exercises the same
// guardPublicHook code path the server uses, so warn/block semantics are
// verified without bouncing the running dev server.
// --------------------------------------------------------------------------

describe.skipIf(!canRunHttp)("P-131 warn-mode (guardPublicHook in-process)", () => {
  let fx: Fixture;
  const originalEnforce = process.env.PUBLIC_HOOK_ENFORCE;

  beforeAll(async () => {
    fx = await createFixture();
  });

  afterAll(async () => {
    if (originalEnforce === undefined) delete process.env.PUBLIC_HOOK_ENFORCE;
    else process.env.PUBLIC_HOOK_ENFORCE = originalEnforce;
    if (fx) await cleanupFixture(fx);
  });

  beforeEach(() => {
    process.env.PUBLIC_HOOK_ENFORCE = "warn";
  });

  async function auditRowsForKey(keyId: string, action: string) {
    const { data } = await fx.admin
      .from("audit_logs")
      .select("action, metadata, created_at")
      .eq("company_id", fx.companyId)
      .eq("action", action)
      .order("created_at", { ascending: false })
      .limit(10);
    return (data ?? []).filter((r) => (r.metadata as { key_id?: string })?.key_id === keyId);
  }

  it("warn: IP not in allowlist → guard returns ok=true and writes public_hook.warn (ip_not_allowed)", async () => {
    // keyPinned only allows 198.51.100.7. Send from a different cf-connecting-ip.
    const body = "{}";
    const ts = String(nowSec());
    const req = new Request(ECHO_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fx.keyPinned.raw}`,
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.99",
        "x-timestamp": ts,
        "x-signature": sign(fx.keyPinned.hmac, ts, body),
      },
      body,
    });
    const res = await guardPublicHook(req, {
      route: "p131:warn-ip",
      scope: "hooks:events",
      requireSignature: true,
    });
    expect(res.ok).toBe(true);
    const rows = await auditRowsForKey(fx.keyPinned.id, "public_hook.warn");
    expect(rows.some((r) => (r.metadata as { reason?: string }).reason === "ip_not_allowed")).toBe(
      true,
    );
  });

  it("warn: missing signature → guard returns ok=true and writes public_hook.warn (signature_missing)", async () => {
    const body = "{}";
    const req = new Request(ECHO_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fx.keyOpen.raw}`,
        "content-type": "application/json",
      },
      body,
    });
    const res = await guardPublicHook(req, {
      route: "p131:warn-sig",
      scope: "hooks:events",
      requireSignature: true,
    });
    expect(res.ok).toBe(true);
    const rows = await auditRowsForKey(fx.keyOpen.id, "public_hook.warn");
    expect(
      rows.some((r) => (r.metadata as { reason?: string }).reason === "signature_missing"),
    ).toBe(true);
  });

  it("warn mode does NOT weaken auth: missing bearer still 401", async () => {
    const req = new Request(ECHO_URL, { method: "POST" });
    const res = await guardPublicHook(req, {
      route: "p131:warn-auth",
      scope: "hooks:events",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("warn mode does NOT weaken rate limit: burst still 429", async () => {
    const body = "{}";
    // Drain a tiny bucket dedicated to this test so we don't step on the
    // HTTP suite's burst bucket (they share the DB).
    let saw429 = false;
    for (let i = 0; i < 8; i++) {
      const ts = String(nowSec());
      const req = new Request("https://internal/p131-warn-rate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fx.keyOpen.raw}`,
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": sign(fx.keyOpen.hmac, ts, body),
        },
        body,
      });
      const res = await guardPublicHook(req, {
        route: `p131:warn-rate-${fx.companySlug}`,
        scope: "hooks:events",
        requireSignature: true,
        rateCapacity: 2,
        rateRefillPerSec: 0.001,
      });
      if (!res.ok && res.response.status === 429) {
        saw429 = true;
        expect(res.response.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
