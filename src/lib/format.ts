// POL-3 — Canonical formatting helpers. Every table/form/tile formats numbers,
// money, quantities, percents and dates through this module so the whole app
// reads identically.
import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

/** One date format everywhere: 05 Aug 2026. */
export const DATE_FORMAT = "dd MMM yyyy";
/** Date + time for hover titles / audit detail. */
export const DATE_TIME_FORMAT = "dd MMM yyyy HH:mm";

export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d =
    value instanceof Date ? value : typeof value === "number" ? new Date(value) : parseISO(value);
  return isValid(d) ? d : null;
}

/** dd MMM yyyy, or the em dash when absent/invalid. */
export function formatDate(value: string | number | Date | null | undefined, fallback = "—") {
  const d = toDate(value);
  return d ? format(d, DATE_FORMAT) : fallback;
}

export function formatDateTime(value: string | number | Date | null | undefined, fallback = "—") {
  const d = toDate(value);
  return d ? format(d, DATE_TIME_FORMAT) : fallback;
}

/** Compact relative label: "3h ago", "in 2d". */
export function formatRelative(value: string | number | Date | null | undefined, fallback = "—") {
  const d = toDate(value);
  if (!d) return fallback;
  const strict = formatDistanceToNowStrict(d, { addSuffix: true })
    .replace(" seconds", "s")
    .replace(" second", "s")
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" months", "mo")
    .replace(" month", "mo")
    .replace(" years", "y")
    .replace(" year", "y");
  return strict;
}

/** Money with the currency code shown (e.g. "USD 1,240,000"). */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined = "USD",
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
) {
  if (amount == null || Number.isNaN(amount)) return "—";
  const code = (currency || "USD").toUpperCase();
  const maximumFractionDigits = opts.maximumFractionDigits ?? 0;
  const minimumFractionDigits = opts.minimumFractionDigits ?? 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      maximumFractionDigits,
      minimumFractionDigits,
    }).format(amount);
  } catch {
    return `${code} ${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(amount)}`;
  }
}

/** Plain number with grouping. */
export function formatNumber(
  value: number | null | undefined,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
    minimumFractionDigits: opts.minimumFractionDigits ?? 0,
  }).format(value);
}

/** Quantity with unit of measure: "1,250 pcs". */
export function formatQty(
  value: number | null | undefined,
  uom?: string | null,
  opts: { maximumFractionDigits?: number } = {},
) {
  if (value == null || Number.isNaN(value)) return "—";
  const n = formatNumber(value, { maximumFractionDigits: opts.maximumFractionDigits ?? 2 });
  return uom ? `${n} ${uom}` : n;
}

/**
 * Percent with 1 decimal. Pass ratios (0–1) with `fromRatio: true`,
 * already-scaled percents (0–100) by default.
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { fromRatio?: boolean; digits?: number } = {},
) {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = opts.fromRatio ? value * 100 : value;
  return `${pct.toFixed(opts.digits ?? 1)}%`;
}
