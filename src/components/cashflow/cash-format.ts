// GC-13 — Shared presentation helpers for cash-flow surfaces.
import { formatCostingMoney } from "@/lib/costing.rules";

export function money(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined ? "—" : formatCostingMoney(value, currency);
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

export function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(Math.round(value));
}

/** Bucket start date shown as YYYY-MM (month) or YYYY-MM-DD (week). */
export function bucketLabel(start: string, granularity: "month" | "week"): string {
  return granularity === "month" ? start.slice(0, 7) : start.slice(0, 10);
}

/** Cash tone: negative balances are adverse. */
export function cashTone(value: number | null): "neutral" | "good" | "warning" | "bad" {
  if (value === null) return "neutral";
  if (value < 0) return "bad";
  return "good";
}

/** Funding tone: any unfunded requirement is adverse, high utilisation is a warning. */
export function fundingTone(
  unfunded: number,
  utilizationPct: number | null,
): "neutral" | "good" | "warning" | "bad" {
  if (unfunded > 0) return "bad";
  if (utilizationPct !== null && utilizationPct >= 90) return "warning";
  return "good";
}
