// FX-01 — Provider-agnostic exchange-rate feed contract + pure import logic.
//
// Policy notes (single source of truth for the FX feed):
//   * fx_rates stays GridMind's authoritative ledger. A provider is an import
//     source only; it never becomes the runtime rate lookup.
//   * fx_rates orientation is (base_code = transaction currency,
//     quote_code = reporting currency) so `rate` converts txn -> reporting.
//     Providers publish anchor->symbol; we invert/cross deterministically.
//   * Manual rows are never overwritten by an import.
//   * A missing currency is reported, never invented, never triangulated
//     through stale data, and never defaulted to 1 (unless base === quote).
import { z } from "zod";

export const FX_IMPORT_SOURCE = "frankfurter";
export const FX_RATE_SCALE = 8; // fx_rates.rate is numeric(20,8)

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------
export interface FxProviderQuote {
  /** Anchor currency the provider quoted from (1 anchor = rate symbol). */
  anchor: string;
  symbol: string;
  rate: number;
}

export interface FxProviderObservation {
  provider: string;
  /** Date the provider observed/published these rates (ISO yyyy-mm-dd). */
  observedOn: string;
  anchor: string;
  /** symbol -> units of symbol per 1 anchor */
  rates: Record<string, number>;
}

export interface FxRateProvider {
  readonly name: string;
  /** Currencies the provider supports (ISO 4217 upper-case). */
  supportedCurrencies(): Promise<string[]>;
  /** Latest published observation for the requested symbols. */
  latest(anchor: string, symbols: string[]): Promise<FxProviderObservation>;
}

export class FxProviderError extends Error {
  constructor(
    public readonly code:
      | "network"
      | "timeout"
      | "http"
      | "invalid_response"
      | "unsupported_currency",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "FxProviderError";
  }
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------
const isoCode = /^[A-Z]{3}$/;

export const frankfurterLatestSchema = z.object({
  amount: z.number().positive().optional(),
  base: z.string().regex(isoCode),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string().regex(isoCode), z.number().positive().finite()),
});

export const frankfurterCurrenciesSchema = z.record(
  z.string().regex(isoCode),
  z.string().min(1),
);

/** Strictly validate + normalize a provider payload into an observation. */
export function parseFrankfurterLatest(
  payload: unknown,
  provider = FX_IMPORT_SOURCE,
): FxProviderObservation {
  const parsed = frankfurterLatestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FxProviderError(
      "invalid_response",
      "Provider payload failed schema validation",
      parsed.error.issues.slice(0, 5),
    );
  }
  const { amount, base, date, rates } = parsed.data;
  if (amount != null && amount !== 1) {
    // Normalize non-unit amounts so downstream math is always per-1-anchor.
    const normalized: Record<string, number> = {};
    for (const [k, v] of Object.entries(rates)) normalized[k] = v / amount;
    return { provider, observedOn: date, anchor: base, rates: normalized };
  }
  return { provider, observedOn: date, anchor: base, rates: { ...rates } };
}

// ---------------------------------------------------------------------------
// Decimal-safe rate math
// ---------------------------------------------------------------------------
/** Round a rate to the ledger scale, HALF-UP away from zero. */
export function roundRate(rate: number, scale: number = FX_RATE_SCALE): number {
  if (!Number.isFinite(rate)) return NaN;
  const f = 10 ** scale;
  const scaled = Number((rate * f).toPrecision(15));
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / f;
}

/**
 * Cross-rate from `from` -> `to` using anchor-denominated quotes
 * (`quotes[x]` = units of x per 1 anchor). Returns null when a leg is missing.
 */
export function crossRate(
  from: string,
  to: string,
  anchor: string,
  quotes: Record<string, number>,
): number | null {
  const F = from.toUpperCase();
  const T = to.toUpperCase();
  const A = anchor.toUpperCase();
  if (F === T) return 1;
  const perAnchor = (c: string): number | null => {
    if (c === A) return 1;
    const v = quotes[c];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const f = perAnchor(F);
  const t = perAnchor(T);
  if (f == null || t == null) return null;
  // 1 F = (1/f) anchor = (t/f) T
  return roundRate(t / f);
}

// ---------------------------------------------------------------------------
// Import planning
// ---------------------------------------------------------------------------
export interface FxImportRequest {
  /** Reporting/base currency the ledger quotes into (fx_rates.quote_code). */
  quoteCurrency: string;
  /** Transaction currencies needing a rate into `quoteCurrency`. */
  transactionCurrencies: string[];
  /** Currencies the provider supports. */
  supported: string[];
}

export interface FxPlannedRate {
  base_code: string;
  quote_code: string;
  rate: number;
}

export interface FxImportPlan {
  requested: string[];
  planned: FxPlannedRate[];
  /** Requested currencies the provider cannot serve. */
  missing: string[];
}

/** Currencies to request, de-duplicated, upper-cased, quote currency excluded. */
export function planRequestedCurrencies(
  transactionCurrencies: readonly string[],
  quoteCurrency: string,
): string[] {
  const q = quoteCurrency.toUpperCase();
  const set = new Set<string>();
  for (const c of transactionCurrencies) {
    const u = (c ?? "").toUpperCase().trim();
    if (isoCode.test(u) && u !== q) set.add(u);
  }
  return Array.from(set).sort();
}

/**
 * Build the ledger rows for an observation. Atomic by design: the caller
 * commits only when `missing` is acceptable — nothing is invented here.
 */
export function buildImportPlan(
  req: FxImportRequest,
  observation: FxProviderObservation,
): FxImportPlan {
  const quote = req.quoteCurrency.toUpperCase();
  const supported = new Set(req.supported.map((c) => c.toUpperCase()));
  const requested = planRequestedCurrencies(req.transactionCurrencies, quote);

  const planned: FxPlannedRate[] = [];
  const missing: string[] = [];

  const quoteServable = supported.has(quote) || observation.anchor.toUpperCase() === quote;

  for (const code of requested) {
    if (!supported.has(code) || !quoteServable) {
      missing.push(code);
      continue;
    }
    const rate = crossRate(code, quote, observation.anchor, observation.rates);
    if (rate == null || !(rate > 0)) {
      missing.push(code);
      continue;
    }
    planned.push({ base_code: code, quote_code: quote, rate });
  }

  return { requested, planned, missing };
}

// ---------------------------------------------------------------------------
// Business-day aware staleness
// ---------------------------------------------------------------------------
/** Saturday/Sunday are non-publication days for central-bank feeds. */
export function isWeekend(isoDate: string): boolean {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Count business days strictly after `fromIso`, up to and including `toIso`. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let count = 0;
  for (let t = from + 86_400_000; t <= to; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export interface FxFreshness {
  businessDaysStale: number;
  stale: boolean;
  /** True when today is a non-publication day — never treated as a failure. */
  nonPublicationDay: boolean;
}

export function assessFreshness(
  lastObservedOn: string | null,
  today: string,
  thresholdBusinessDays: number,
): FxFreshness {
  const nonPublicationDay = isWeekend(today);
  if (!lastObservedOn) {
    return { businessDaysStale: Infinity, stale: true, nonPublicationDay };
  }
  const days = businessDaysBetween(lastObservedOn, today);
  return {
    businessDaysStale: days,
    stale: days > Math.max(1, thresholdBusinessDays),
    nonPublicationDay,
  };
}

// ---------------------------------------------------------------------------
// Idempotent persistence decisions
// ---------------------------------------------------------------------------
export interface ExistingLedgerRow {
  base_code: string;
  quote_code: string;
  as_of: string;
  source: string;
  rate: number;
}

export interface FxPersistDecision {
  /** Rows safe to upsert on (base_code, quote_code, as_of, source). */
  upserts: Array<FxPlannedRate & { as_of: string; source: string; provider: string }>;
  /** Rows deliberately not written, with a reason. */
  skipped: Array<{ base_code: string; quote_code: string; reason: string }>;
}

/**
 * Decide what to write. Manual rows for the same pair+date win and are left
 * untouched. Re-running the same date is a no-op when nothing changed.
 */
export function decidePersistence(
  planned: readonly FxPlannedRate[],
  asOf: string,
  existing: readonly ExistingLedgerRow[],
  source: string = FX_IMPORT_SOURCE,
  provider: string = FX_IMPORT_SOURCE,
): FxPersistDecision {
  const key = (b: string, q: string, s: string) => `${b}|${q}|${s}`;
  const manual = new Set<string>();
  const sameSource = new Map<string, number>();
  for (const row of existing) {
    if (row.as_of !== asOf) continue;
    if (row.source === "manual") manual.add(key(row.base_code, row.quote_code, "manual"));
    if (row.source === source) {
      sameSource.set(key(row.base_code, row.quote_code, source), Number(row.rate));
    }
  }

  const upserts: FxPersistDecision["upserts"] = [];
  const skipped: FxPersistDecision["skipped"] = [];

  for (const p of planned) {
    if (manual.has(key(p.base_code, p.quote_code, "manual"))) {
      skipped.push({
        base_code: p.base_code,
        quote_code: p.quote_code,
        reason: "manual_rate_exists",
      });
      continue;
    }
    const prior = sameSource.get(key(p.base_code, p.quote_code, source));
    if (prior != null && roundRate(prior) === roundRate(p.rate)) {
      skipped.push({ base_code: p.base_code, quote_code: p.quote_code, reason: "unchanged" });
      continue;
    }
    upserts.push({ ...p, rate: roundRate(p.rate), as_of: asOf, source, provider });
  }

  return { upserts, skipped };
}

/**
 * Atomicity gate: the payload must cover every requested currency before any
 * write is committed. Callers preserve the last successful data on rejection.
 */
export function validateCoverage(
  plan: FxImportPlan,
  options: { allowPartial?: boolean } = {},
): { ok: boolean; reason?: string } {
  if (plan.requested.length === 0) return { ok: true };
  if (plan.planned.length === 0) {
    return { ok: false, reason: "provider_returned_no_usable_rates" };
  }
  if (!options.allowPartial && plan.missing.length > 0) {
    return { ok: false, reason: `unsupported_currencies:${plan.missing.join(",")}` };
  }
  return { ok: true };
}
