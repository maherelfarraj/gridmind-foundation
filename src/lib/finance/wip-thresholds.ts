// P-197 — Work-in-progress thresholds.
//
// A contract is flagged when certified-but-unbilled work (positive WIP)
// exceeds this fraction of the contract value. Company-wide default; kept as a
// constant so P-199's unbilled-certified alert uses the exact same number.

/** Under-billing highlight threshold: 10% of contract value. */
export const UNDER_BILLED_THRESHOLD_PCT = 0.1;

/** Over-billing (negative WIP) attention threshold: 10% of contract value. */
export const OVER_BILLED_THRESHOLD_PCT = 0.1;
