/**
 * P-203 — Bond expiry engine: pure helpers (no I/O, unit-tested by P-206).
 *
 * The daily cron (src/routes/api/cron/bond-expiry.ts) materializes instrument
 * status from these functions and emits threshold notifications. Everything in
 * here is deterministic given (expiry_date, today).
 */
import { instrumentTypeLabel } from "@/lib/bonds.rules";

const MS_DAY = 86_400_000;

/** days_to_expiry = expiry_date − current_date (whole days, UTC). */
export function bondDaysToExpiry(expiry: string | null | undefined, today: string): number | null {
  if (!expiry) return null;
  const a = Date.parse(`${String(expiry).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / MS_DAY);
}

export type MaterializedStatus = "active" | "expiring_soon" | "expired";

/** < 0 → expired; 0..90 → expiring_soon; > 90 → active. */
export function materializedStatus(days: number | null): MaterializedStatus | null {
  if (days === null) return null;
  if (days < 0) return "expired";
  if (days <= 90) return "expiring_soon";
  return "active";
}

/** Escalating warning thresholds, widest first. */
export const BOND_THRESHOLDS = [90, 60, 30, 7] as const;
export type BondThreshold = (typeof BOND_THRESHOLDS)[number];

/** Roles notified at a given threshold — 7 days escalates to three roles. */
export const THRESHOLD_ROLES: Record<number, readonly string[]> = {
  90: ["finance_admin"],
  60: ["finance_admin"],
  30: ["finance_admin"],
  7: ["finance_admin", "legal_admin", "company_admin"],
};

export function rolesForThreshold(threshold: number): readonly string[] {
  return THRESHOLD_ROLES[threshold] ?? ["finance_admin"];
}

/** Thresholds an instrument has crossed today (not yet expired). */
export function crossedThresholds(days: number | null): BondThreshold[] {
  if (days === null || days < 0) return [];
  return BOND_THRESHOLDS.filter((t) => days <= t);
}

/** Stable dedupe key: `<instrument_id>:<threshold>`. */
export function bondFingerprint(instrumentId: string, threshold: number): string {
  return `${instrumentId}:${threshold}`;
}

export function formatBondAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

export interface BondNoticeInput {
  instrument_number: string;
  instrument_type: string;
  beneficiary_name: string;
  expiry_date: string;
  amount: number;
  currency_code: string;
}

/** "Performance bond BG-0012 for Client X expires in 30 days on 2026-08-26 (JOD 1,000.00)." */
export function bondNoticeMessage(row: BondNoticeInput, days: number): string {
  const type = instrumentTypeLabel(row.instrument_type);
  const when = days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`;
  return `${type} ${row.instrument_number} for ${row.beneficiary_name} ${when} on ${row.expiry_date.slice(0, 10)} (${formatBondAmount(Number(row.amount ?? 0), row.currency_code)}).`;
}

export interface BondRunSummary {
  expired: number;
  expiring_soon: number;
  notifications: number;
}

export interface ExpiringBondsSummary {
  count: number;
  per_currency: Array<{ currency_code: string; amount: number }>;
}

/**
 * Cockpit tile 8 — count + Σ amount per currency of coverage instruments
 * expiring within `within` days (0 ≤ days_to_expiry ≤ within).
 */
export function summarizeExpiringBonds(
  rows: Array<{ expiry_date: string | null; amount: number | null; currency_code: string }>,
  today: string,
  within = 30,
): ExpiringBondsSummary {
  const map = new Map<string, number>();
  let count = 0;
  for (const r of rows) {
    const days = bondDaysToExpiry(r.expiry_date, today);
    if (days === null || days < 0 || days > within) continue;
    count += 1;
    map.set(r.currency_code, (map.get(r.currency_code) ?? 0) + Number(r.amount ?? 0));
  }
  return {
    count,
    per_currency: [...map.entries()]
      .map(([currency_code, amount]) => ({ currency_code, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Alias used by the P-206 boundary tests — same rule as materializedStatus. */
export const bondStatusForDays = materializedStatus;
