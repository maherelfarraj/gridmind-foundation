// GC-02 — Decimal-safe money math + FX resolution for the Costing workspace.
//
// Policy (single source of truth for the module):
//   * All money is compared/summed in integer minor units. Never compare
//     project money with binary-float equality.
//   * Rounding is HALF-UP away from zero at the currency minor unit
//     (default 2). Conversion rounds once, at the point of conversion.
//   * fx_rates is keyed (base_code = transaction currency,
//     quote_code = reporting/base currency), so:
//         project_amount = round(txn_amount * rate)
//   * Same-currency rows resolve to rate 1 with source "parity".
//   * A rate is STALE when the effective-dated rate is older than
//     FX_STALE_DAYS before the requested date. Stale rates may be used for
//     drafts but are surfaced as a warning.
//   * A MISSING rate blocks approval; drafts may be saved unconverted.
//   * Approval snapshots (locks) the rate + converted amount. Reversal never
//     re-rates: it negates the stored transaction and project amounts.
import { z } from "zod";

export const DEFAULT_MINOR_UNIT = 2;
export const FX_STALE_DAYS = 30;

export type FxSource = "parity" | "table" | "manual";

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Integer minor units (e.g. cents), HALF-UP away from zero. */
export function toMinor(amount: number, minorUnit: number = DEFAULT_MINOR_UNIT): number {
  const factor = 10 ** minorUnit;
  const scaled = num(amount) * factor;
  // Correct binary representation drift (e.g. 1.005 * 100 === 100.49999...).
  const corrected = Number(scaled.toPrecision(15));
  return corrected < 0 ? -Math.round(-corrected) : Math.round(corrected);
}

export function fromMinor(minor: number, minorUnit: number = DEFAULT_MINOR_UNIT): number {
  return Math.trunc(num(minor)) / 10 ** minorUnit;
}

/** Round a money amount to its currency minor unit, HALF-UP away from zero. */
export function roundMoney(amount: number, minorUnit: number = DEFAULT_MINOR_UNIT): number {
  return fromMinor(toMinor(amount, minorUnit), minorUnit);
}

/** Decimal-safe sum: adds in minor units, returns a rounded major amount. */
export function sumMoney(
  amounts: readonly number[],
  minorUnit: number = DEFAULT_MINOR_UNIT,
): number {
  let acc = 0;
  for (const a of amounts) acc += toMinor(a, minorUnit);
  return fromMinor(acc, minorUnit);
}

/** Equality on money — never use `===` on floats. */
export function moneyEquals(a: number, b: number, minorUnit: number = DEFAULT_MINOR_UNIT): boolean {
  return toMinor(a, minorUnit) === toMinor(b, minorUnit);
}

/** Convert a transaction amount into reporting currency. Rounds exactly once. */
export function convertMoney(
  amount: number,
  rate: number,
  minorUnit: number = DEFAULT_MINOR_UNIT,
): number {
  return roundMoney(num(amount) * num(rate), minorUnit);
}

// ---------------------------------------------------------------------------
// FX resolution
// ---------------------------------------------------------------------------
export interface FxTableRate {
  rate: number;
  as_of: string; // ISO date
  source?: string | null;
}

export interface FxOverride {
  rate: number;
  reason: string;
}

export interface FxResolveInput {
  txnCurrency: string;
  baseCurrency: string;
  onDate: string; // ISO date the rate should be effective for
  tableRate?: FxTableRate | null;
  override?: FxOverride | null;
}

export interface FxResolution {
  rate: number | null;
  rate_date: string | null;
  source: FxSource;
  stale: boolean;
  missing: boolean;
  override_reason: string | null;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function resolveFx(input: FxResolveInput): FxResolution {
  const txn = (input.txnCurrency || "").toUpperCase();
  const base = (input.baseCurrency || "").toUpperCase();

  if (input.override && num(input.override.rate) > 0) {
    return {
      rate: num(input.override.rate),
      rate_date: input.onDate,
      source: "manual",
      stale: false,
      missing: false,
      override_reason: input.override.reason,
    };
  }

  if (txn && txn === base) {
    return {
      rate: 1,
      rate_date: input.onDate,
      source: "parity",
      stale: false,
      missing: false,
      override_reason: null,
    };
  }

  const t = input.tableRate;
  if (!t || num(t.rate) <= 0) {
    return {
      rate: null,
      rate_date: null,
      source: "table",
      stale: false,
      missing: true,
      override_reason: null,
    };
  }

  return {
    rate: num(t.rate),
    rate_date: t.as_of,
    source: "table",
    stale: daysBetween(t.as_of, input.onDate) > FX_STALE_DAYS,
    missing: false,
    override_reason: null,
  };
}

/** Approval gate: a row may only be approved with a usable, non-missing rate. */
export function canApproveWithFx(fx: {
  rate?: number | null;
  fx_rate?: number | null;
  missing?: boolean;
}): boolean {
  const rate = fx.rate ?? fx.fx_rate ?? null;
  return !fx.missing && rate != null && rate > 0;
}

/**
 * Reversal negates the stored transaction and project-currency values using the
 * ALREADY LOCKED rate. It must never re-rate.
 */
export function reverseSnapshot(row: {
  amount: number;
  amount_base: number;
  fx_rate: number;
  fx_rate_date: string | null;
  fx_source: FxSource;
}): {
  amount: number;
  amount_base: number;
  fx_rate: number;
  fx_rate_date: string | null;
  fx_source: FxSource;
} {
  return {
    amount: -num(row.amount),
    amount_base: -num(row.amount_base),
    fx_rate: num(row.fx_rate),
    fx_rate_date: row.fx_rate_date,
    fx_source: row.fx_source,
  };
}

export const fxOverrideSchema = z
  .object({
    rate: z.number().positive().max(1_000_000),
    reason: z.string().trim().min(3).max(500),
  })
  .nullable()
  .optional();
