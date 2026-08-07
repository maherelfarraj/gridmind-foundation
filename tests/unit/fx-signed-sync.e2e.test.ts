// @vitest-environment node
//
// FX-02 — End-to-end signed-sync coverage.
//
//   signed cron request → guard (auth / replay / rate limit)
//     → mocked Frankfurter provider → currency discovery + cross-rates
//     → idempotent fx_rates persistence → audit-run completion
//     → health evaluation → de-duplicated notification
//
// No live network calls; no production secrets.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeSupabase, type Tables } from "../helpers/fake-supabase";

// ---- service-role client is shared by the guard and the cron route --------
let fake: FakeSupabase;
vi.mock("@/integrations/supabase/admin", () => ({
  createServiceRoleClient: () => fake,
  admin: () => fake,
}));

const { runFxImport } = await import("@/lib/fx/import.server");
const { FxProviderError } = await import("@/lib/fx/provider");
const { hmacSha256Hex } = await import("@/lib/public-api/guard");
const { Route } = await import("@/routes/api/public/cron/fx-rates");

const CRON_KEY = "sb_publishable_test_key";
/** Observation date = today in the configured schedule timezone, so freshness
 *  assertions do not drift as the suite ages. */
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Amman",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const COMPANY = "11111111-1111-1111-1111-111111111111";
const FINANCE_USER = "22222222-2222-2222-2222-222222222222";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function seed(over: Partial<Tables> = {}): Tables {
  return {
    companies: [{ id: COMPANY, name: "GSI" }],
    user_roles: [{ user_id: FINANCE_USER, company_id: COMPANY, role: "finance_admin" }],
    fx_alert_settings: [
      {
        company_id: COMPANY,
        enabled: true,
        notify_role: "finance_admin",
        failure_threshold: 2,
        stale_business_days: 3,
        alert_missing_currency: true,
        large_move_pct: 5,
      },
    ],
    fx_provider_settings: [
      {
        id: true,
        provider: "frankfurter",
        enabled: true,
        base_currency: "USD",
        treasury_currencies: ["EUR", "JOD"],
        schedule_time: "17:30",
        schedule_timezone: "Asia/Amman",
        staleness_business_days: 3,
      },
    ],
    projects: [{ id: "p1", company_id: COMPANY, currency: "USD" }],
    fx_rates: [],
    fx_import_runs: [],
    fx_health_state: [],
    notifications: [],
    audit_logs: [],
    currencies: [
      { code: "USD", name: "US Dollar", minor_unit: 2 },
      { code: "EUR", name: "Euro", minor_unit: 2 },
      { code: "JOD", name: "Jordanian Dinar", minor_unit: 3 },
    ],
    ...over,
  } as Tables;
}

/** Deterministic provider double — never touches the network. */
function stubProvider(
  over: {
    supported?: string[];
    observedOn?: string;
    rates?: Record<string, number>;
    fail?: Error;
  } = {},
) {
  return {
    name: "frankfurter",
    supportedCurrencies: async () => {
      if (over.fail) throw over.fail;
      return over.supported ?? ["EUR", "JOD", "USD"];
    },
    latest: async () => {
      if (over.fail) throw over.fail;
      return {
        provider: "frankfurter",
        anchor: "USD",
        observedOn: over.observedOn ?? TODAY,
        rates: over.rates ?? { EUR: 0.92, JOD: 0.709 },
      };
    },
  } as never;
}

async function cronRequest(
  body = "{}",
  opts: { apikey?: string | null; bearer?: string; sign?: boolean } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apikey !== null) headers["apikey"] = opts.apikey ?? CRON_KEY;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;
  if (opts.sign) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["x-timestamp"] = ts;
    headers["x-signature"] = await hmacSha256Hex("shhh", `${ts}.${body}`);
  }
  return new Request("https://x.test/api/public/cron/fx-rates", {
    method: "POST",
    headers,
    body,
  });
}

// The route object exposes the POST handler under server.handlers.
function cronHandler(): (ctx: { request: Request }) => Promise<Response> {
  const opts = (Route as unknown as { options: { server: { handlers: Record<string, unknown> } } })
    .options;
  return opts.server.handlers["POST"] as never;
}

beforeEach(() => {
  fake = createFakeSupabase(seed(), {
    rpc: { consume_rate_limit: () => true, verify_api_key: () => [] },
  });
  process.env["PUBLIC_HOOK_ENFORCE"] = "block";
  process.env["SUPABASE_PUBLISHABLE_KEY"] = CRON_KEY;
  process.env["CRON_APIKEY"] = CRON_KEY;
});

afterEach(() => {
  delete process.env["PUBLIC_HOOK_ENFORCE"];
  delete process.env["SUPABASE_PUBLISHABLE_KEY"];
  delete process.env["CRON_APIKEY"];
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// Signed cron authorization
// --------------------------------------------------------------------------

describe("signed cron authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await cronHandler()({ request: await cronRequest("{}", { apikey: null }) });
    expect(res.status).toBe(401);
    expect(fake.db["fx_import_runs"]).toHaveLength(0);
  });

  it("rejects a wrong apikey", async () => {
    const res = await cronHandler()({ request: await cronRequest("{}", { apikey: "nope" }) });
    expect(res.status).toBe(401);
    expect(fake.db["fx_import_runs"]).toHaveLength(0);
  });

  it("rejects when the rate limiter is exhausted (replay flood)", async () => {
    fake = createFakeSupabase(seed(), { rpc: { consume_rate_limit: () => false } });
    const res = await cronHandler()({ request: await cronRequest() });
    expect(res.status).toBe(429);
    expect(fake.db["fx_import_runs"]).toHaveLength(0);
  });

  it("never runs the import for a non-cron API-key caller", async () => {
    fake = createFakeSupabase(seed(), {
      rpc: {
        consume_rate_limit: () => true,
        verify_api_key: () => [
          {
            key_id: "k1",
            company_id: COMPANY,
            scopes: ["fx:sync"],
            allowed_ips: [],
            hmac_secret: "shhh",
          },
        ],
      },
    });
    const res = await cronHandler()({
      request: await cronRequest("{}", { apikey: null, bearer: "raw-key", sign: true }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "cron_only" });
    expect(fake.db["fx_import_runs"]).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Happy path: import → audit → health → notification
// --------------------------------------------------------------------------

describe("signed sync end-to-end", () => {
  it("imports rates, completes the audit run, and stays healthy without alerting", async () => {
    const res = await runFxImport(fake as never, {
      trigger: "scheduled",
      provider: stubProvider(),
    });

    expect(res.status).toBe("success");
    expect(res.imported).toBeGreaterThan(0);

    // Ledger persisted with provider attribution.
    const rates = fake.db["fx_rates"]!;
    expect(rates.length).toBe(res.imported);
    for (const r of rates) {
      expect(r["source"]).toBe("frankfurter");
      expect(r["provider_observed_on"]).toBe(TODAY);
    }

    // Exactly one completed audit run, opened before the provider call.
    const runs = fake.db["fx_import_runs"]!;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "success",
      trigger: "scheduled",
      actor_kind: "cron",
      provider: "frankfurter",
      observation_date: TODAY,
      failed_count: 0,
    });
    expect(runs[0]!["duration_ms"]).not.toBeNull();

    // Health is evaluated; a healthy first run must not raise an alert.
    expect(fake.db["notifications"]).toHaveLength(0);
    expect(fake.db["fx_health_state"]![0]).toMatchObject({ status: "healthy" });
  });

  it("is idempotent on rerun for the same observation date", async () => {
    await runFxImport(fake as never, { trigger: "scheduled", provider: stubProvider() });
    const first = fake.db["fx_rates"]!.length;

    const second = await runFxImport(fake as never, {
      trigger: "scheduled",
      provider: stubProvider(),
    });

    expect(second.status).toBe("success");
    expect(fake.db["fx_rates"]).toHaveLength(first);
    expect(fake.db["fx_import_runs"]).toHaveLength(2);
  });

  it("never overwrites a manual rate for the same date", async () => {
    fake.db["fx_rates"] = [
      {
        id: "manual-1",
        base_code: "USD",
        quote_code: "EUR",
        rate: 0.5,
        as_of: TODAY,
        source: "manual",
        provider: null,
      },
    ];

    await runFxImport(fake as never, { trigger: "scheduled", provider: stubProvider() });

    const manual = fake.db["fx_rates"]!.find((r) => r["id"] === "manual-1");
    expect(manual).toMatchObject({ rate: 0.5, source: "manual", provider: null });
  });
});

// --------------------------------------------------------------------------
// Failure paths
// --------------------------------------------------------------------------

describe("failure recovery and alerting", () => {
  it("records a failed run with a structured error and preserves prior rates", async () => {
    await runFxImport(fake as never, { trigger: "scheduled", provider: stubProvider() });
    const goodRates = JSON.parse(JSON.stringify(fake.db["fx_rates"])) as unknown[];

    const res = await runFxImport(fake as never, {
      trigger: "scheduled",
      provider: stubProvider({ fail: new FxProviderError("timeout", "Provider timed out") }),
    });

    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("timeout");
    expect(fake.db["fx_rates"]).toEqual(goodRates);

    const failed = fake.db["fx_import_runs"]!.find((r) => r["status"] === "failed");
    expect(failed).toMatchObject({ error_code: "timeout", failed_count: 1 });
  });

  it("rejects a malformed provider payload before writing any rate", async () => {
    const bad = {
      name: "frankfurter",
      supportedCurrencies: async () => ["EUR", "USD"],
      latest: async () => ({
        provider: "frankfurter",
        anchor: "USD",
        observedOn: TODAY,
        rates: { EUR: Number.NaN },
      }),
    } as never;

    const res = await runFxImport(fake as never, { trigger: "scheduled", provider: bad });

    expect(res.status).toBe("failed");
    expect(fake.db["fx_rates"]).toHaveLength(0);
    expect(fake.db["fx_import_runs"]![0]).toMatchObject({ status: "failed" });
  });

  it("reports missing currencies the provider does not support", async () => {
    const res = await runFxImport(fake as never, {
      trigger: "scheduled",
      provider: stubProvider({ supported: ["EUR", "USD"], rates: { EUR: 0.92 } }),
    });

    expect(res.status).toBe("success");
    expect(res.missing).toContain("JOD");
    expect(fake.db["fx_import_runs"]![0]!["missing_codes"]).toContain("JOD");
  });

  it("alerts once on failure and once again only on recovery", async () => {
    const failing = () =>
      runFxImport(fake as never, {
        trigger: "scheduled",
        provider: stubProvider({ fail: new FxProviderError("network", "boom") }),
      });

    await failing();
    await failing();
    const afterFailures = fake.db["notifications"]!.length;
    expect(afterFailures).toBeGreaterThan(0);
    expect(fake.db["fx_health_state"]![0]!["last_notified_status"]).toBeTruthy();

    // A third consecutive failure must not re-notify (deduplicated).
    await failing();
    expect(fake.db["notifications"]).toHaveLength(afterFailures);

    // Recovery emits exactly one more notification.
    await runFxImport(fake as never, { trigger: "scheduled", provider: stubProvider() });
    expect(fake.db["notifications"]!.length).toBe(afterFailures + 1);
    expect(fake.db["notifications"]!.at(-1)).toMatchObject({
      type: "fx.feed.recovered",
      user_id: FINANCE_USER,
    });
  });
});
