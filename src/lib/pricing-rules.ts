// P-046 — Pricing checklist thresholds and approval entity keys.
// COMPANY_BASE_CURRENCY is a placeholder constant until P-111 makes it
// per-company configurable via a `companies.base_currency` column.
export const COMPANY_BASE_CURRENCY = "USD";
export const MARGIN_FLOOR_PCT = 8;
export const CONTINGENCY_FLOOR_PCT = 5;
export const FX_MAX_AGE_HOURS = 24;
export const PRICING_ENTITY = "proposal_pricing";
export const PRICING_RULE_KEY = "proposal_pricing_cfo";
