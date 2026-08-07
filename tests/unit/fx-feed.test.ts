// FX-01 — Exchange-rate feed: provider validation, orientation math, idempotency,
// staleness, and manual-rate preservation. No live network calls.
import { describe, expect, it, vi } from "vitest";

import { FrankfurterProvider, assertAllowedFxUrl } from "@/lib/fx/frankfurter.server";
import {
  FxProviderError,
  assessFreshness,
  buildImportPlan,
  businessDaysBetween,
  crossRate,
  decidePersistence,
  isWeekend,
  parseFrankfurterLatest,
  planRequestedCurrencies,
  roundRate,
  validateCoverage,
  type FxProviderObservation,
} from "@/lib/fx/provider";

const OBS: FxProviderObservation = {
  provider: "frankfurter",
  observedOn: "2026-08-06",
  anchor: "USD",
  rates: { EUR: 0.8664, GBP: 0.75, CHF: 0.8 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("provider URL allowlist", () => {
  it("accepts the documented host over HTTPS", () => {
    expect(assertAllowedFxUrl("https://api.frankfurter.dev/v1").hostname).toBe(
      "api.frankfurter.dev",
    );
  });
  it("rejects other hosts and plain HTTP", () => {
    expect(() => assertAllowedFxUrl("https://evil.example.com/v1")).toThrow(FxProviderError);
    expect(() => assertAllowedFxUrl("http://api.frankfurter.dev/v1")).toThrow(FxProviderError);
    expect(() => assertAllowedFxUrl("not-a-url")).toThrow(FxProviderError);
  });
});

describe("response schema validation", () => {
  it("parses a valid payload", () => {
    const o = parseFrankfurterLatest({
      amount: 1,
      base: "USD",
      date: "2026-08-06",
      rates: { EUR: 0.8664 },
    });
    expect(o.anchor).toBe("USD");
    expect(o.observedOn).toBe("2026-08-06");
    expect(o.rates["EUR"]).toBe(0.8664);
  });

  it("normalizes non-unit amounts", () => {
    const o = parseFrankfurterLatest({
      amount: 100,
      base: "USD",
      date: "2026-08-06",
      rates: { EUR: 86.64 },
    });
    expect(o.rates["EUR"]).toBeCloseTo(0.8664, 8);
  });

  it("rejects malformed, negative, or partial payloads", () => {
    expect(() => parseFrankfurterLatest({ base: "US", date: "2026-08-06", rates: {} })).toThrow(
      FxProviderError,
    );
    expect(() =>
      parseFrankfurterLatest({ base: "USD", date: "06-08-2026", rates: { EUR: 1 } }),
    ).toThrow(FxProviderError);
    expect(() =>
      parseFrankfurterLatest({ base: "USD", date: "2026-08-06", rates: { EUR: -1 } }),
    ).toThrow(FxProviderError);
    expect(() => parseFrankfurterLatest(null)).toThrow(FxProviderError);
  });
});

describe("orientation and cross-rate math", () => {
  it("inverts anchor quotes into txn -> reporting orientation", () => {
    // 1 USD = 0.8664 EUR  =>  1 EUR = 1.15420129 USD
    expect(crossRate("EUR", "USD", "USD", OBS.rates)).toBe(roundRate(1 / 0.8664));
  });

  it("crosses two non-anchor currencies deterministically", () => {
    // 1 GBP = (0.8664 / 0.75) EUR
    expect(crossRate("GBP", "EUR", "USD", OBS.rates)).toBe(roundRate(0.8664 / 0.75));
    expect(crossRate("GBP", "EUR", "USD", OBS.rates)).toBe(
      crossRate("GBP", "EUR", "USD", OBS.rates),
    );
  });

  it("returns parity for identical currencies and null for missing legs", () => {
    expect(crossRate("USD", "USD", "USD", OBS.rates)).toBe(1);
    expect(crossRate("JOD", "USD", "USD", OBS.rates)).toBeNull();
  });

  it("rounds rates half-up at ledger scale", () => {
    expect(roundRate(1.123456785)).toBe(1.12345679);
    expect(roundRate(1 / 3)).toBe(0.33333333);
  });
});

describe("import planning and coverage", () => {
  const supported = ["EUR", "GBP", "CHF", "USD"];

  it("deduplicates requested currencies and drops the quote currency", () => {
    expect(planRequestedCurrencies(["eur", "EUR", "USD", "gbp", "e", ""], "USD")).toEqual([
      "EUR",
      "GBP",
    ]);
  });

  it("separates unsupported currencies from payload defects", () => {
    const plan = buildImportPlan(
      { quoteCurrency: "USD", transactionCurrencies: ["EUR", "GBP", "JOD"], supported },
      OBS,
    );
    expect(plan.planned.map((p) => p.base_code)).toEqual(["EUR", "GBP"]);
    expect(plan.unsupported).toEqual(["JOD"]);
    expect(plan.missing).toEqual([]);
    expect(validateCoverage(plan).ok).toBe(true);
  });

  it("rejects a partial payload for a supported currency", () => {
    const plan = buildImportPlan(
      { quoteCurrency: "USD", transactionCurrencies: ["EUR", "CHF"], supported },
      { ...OBS, rates: { EUR: 0.8664 } },
    );
    expect(plan.missing).toEqual(["CHF"]);
    const cov = validateCoverage(plan);
    expect(cov.ok).toBe(false);
    expect(cov.reason).toContain("incomplete_payload");
  });

  it("plans into a non-anchor reporting currency", () => {
    const plan = buildImportPlan(
      { quoteCurrency: "EUR", transactionCurrencies: ["USD", "GBP"], supported },
      OBS,
    );
    expect(plan.planned).toEqual([
      { base_code: "GBP", quote_code: "EUR", rate: roundRate(0.8664 / 0.75) },
      { base_code: "USD", quote_code: "EUR", rate: 0.8664 },
    ]);
  });
});

describe("idempotent persistence", () => {
  const planned = [
    { base_code: "EUR", quote_code: "USD", rate: 1.1542 },
    { base_code: "GBP", quote_code: "USD", rate: 1.3333 },
  ];

  it("writes everything on a first run", () => {
    const d = decidePersistence(planned, "2026-08-06", []);
    expect(d.upserts).toHaveLength(2);
    expect(d.skipped).toHaveLength(0);
    expect(d.upserts[0]!.source).toBe("frankfurter");
  });

  it("is a no-op when rerun with identical data", () => {
    const existing = planned.map((p) => ({
      ...p,
      as_of: "2026-08-06",
      source: "frankfurter",
    }));
    const d = decidePersistence(planned, "2026-08-06", existing);
    expect(d.upserts).toHaveLength(0);
    expect(d.skipped.every((s) => s.reason === "unchanged")).toBe(true);
  });

  it("never overwrites a manual rate for the same pair and date", () => {
    const d = decidePersistence(planned, "2026-08-06", [
      { base_code: "EUR", quote_code: "USD", as_of: "2026-08-06", source: "manual", rate: 1.2 },
    ]);
    expect(d.skipped).toEqual([
      { base_code: "EUR", quote_code: "USD", reason: "manual_rate_exists" },
    ]);
    expect(d.upserts.map((u) => u.base_code)).toEqual(["GBP"]);
  });

  it("updates an imported rate that changed", () => {
    const d = decidePersistence(planned, "2026-08-06", [
      {
        base_code: "EUR",
        quote_code: "USD",
        as_of: "2026-08-06",
        source: "frankfurter",
        rate: 1.1,
      },
    ]);
    expect(d.upserts.map((u) => u.base_code)).toEqual(["EUR", "GBP"]);
  });

  it("ignores rows from other dates", () => {
    const d = decidePersistence(planned, "2026-08-06", [
      { base_code: "EUR", quote_code: "USD", as_of: "2026-08-05", source: "manual", rate: 1.2 },
    ]);
    expect(d.upserts).toHaveLength(2);
  });
});

describe("business-day aware staleness", () => {
  it("knows weekends", () => {
    expect(isWeekend("2026-08-08")).toBe(true); // Saturday
    expect(isWeekend("2026-08-09")).toBe(true); // Sunday
    expect(isWeekend("2026-08-07")).toBe(false);
  });

  it("counts only business days", () => {
    expect(businessDaysBetween("2026-08-07", "2026-08-10")).toBe(1); // Fri -> Mon
    expect(businessDaysBetween("2026-08-07", "2026-08-14")).toBe(5);
  });

  it("does not flag a Friday observation read on the weekend", () => {
    const f = assessFreshness("2026-08-07", "2026-08-09", 3);
    expect(f.businessDaysStale).toBe(0);
    expect(f.stale).toBe(false);
    expect(f.nonPublicationDay).toBe(true);
  });

  it("flags an observation beyond the threshold", () => {
    const f = assessFreshness("2026-07-27", "2026-08-06", 3);
    expect(f.stale).toBe(true);
  });

  it("treats no observation as stale", () => {
    expect(assessFreshness(null, "2026-08-06", 3).stale).toBe(true);
  });
});

describe("FrankfurterProvider transport", () => {
  const opts = { sleep: async () => {}, backoffMs: 1 };

  it("fetches and validates the latest observation", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ amount: 1, base: "USD", date: "2026-08-06", rates: { EUR: 0.8664 } }),
    );
    const p = new FrankfurterProvider({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const obs = await p.latest("USD", ["EUR", "usd"]);
    expect(obs.rates["EUR"]).toBe(0.8664);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR",
    );
  });

  it("retries 5xx then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n < 3
        ? jsonResponse({ message: "boom" }, 503)
        : jsonResponse({ base: "USD", date: "2026-08-06", rates: { EUR: 0.9 } });
    });
    const p = new FrankfurterProvider({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.latest("USD", ["EUR"])).resolves.toMatchObject({ observedOn: "2026-08-06" });
    expect(n).toBe(3);
  });

  it("does not retry a 404 and surfaces a structured error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "not found" }, 404));
    const p = new FrankfurterProvider({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.latest("USD", ["EUR"])).rejects.toMatchObject({ code: "http" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded retries on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const p = new FrankfurterProvider({
      ...opts,
      maxAttempts: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(p.supportedCurrencies()).rejects.toMatchObject({ code: "network" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed currency list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ EURO: 123 }));
    const p = new FrankfurterProvider({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.supportedCurrencies()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
