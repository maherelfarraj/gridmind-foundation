// P-195 — AR aging collection-probability weights.
//
// Single source of truth for how much of each aging bucket we expect to
// actually collect. Tunable per lender covenant / historical collection
// performance — NEVER hardcode these numbers anywhere else in the app.
//
//   expected cash = Σ (invoice balance in base currency × weight(bucket))
//
// Rationale for the defaults (conservative straight-line decay):
//   current  0.90 — not yet due; small allowance for disputes and slippage
//   1-30     0.75 — mildly late; usually administrative delay
//   31-60    0.50 — materially late; needs active collection
//   61-90    0.25 — at-risk; escalation / legal review territory
//   90+      0.10 — presumed impaired unless specifically secured
export const AGING_WEIGHTS = {
  current: 0.9,
  d1_30: 0.75,
  d31_60: 0.5,
  d61_90: 0.25,
  d90_plus: 0.1,
} as const;

export type AgingBucketKey = keyof typeof AGING_WEIGHTS;

/** Bucket order used by every table, chart and export. */
export const AGING_BUCKETS: readonly AgingBucketKey[] = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
] as const;

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  current: "Current",
  d1_30: "1-30",
  d31_60: "31-60",
  d61_90: "61-90",
  d90_plus: "90+",
};

export function agingWeight(bucket: AgingBucketKey): number {
  return AGING_WEIGHTS[bucket];
}
