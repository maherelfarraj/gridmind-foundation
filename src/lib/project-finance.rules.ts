// P-082 — Project finance: pure helpers + Zod schemas.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const FACILITY_TYPES = [
  "term_loan",
  "revolver",
  "construction_loan",
  "letter_of_credit",
  "bond",
  "equity",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const DD_ITEM_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "accepted",
  "waived",
] as const;
export type DdItemStatus = (typeof DD_ITEM_STATUSES)[number];

export const DD_CATEGORIES = [
  "technical",
  "legal",
  "financial",
  "hse",
  "insurance",
  "esg",
] as const;
export type DdCategory = (typeof DD_CATEGORIES)[number];

export const FACILITY_STATUSES = ["active", "repaid", "cancelled"] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export interface PpaRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  counterparty: string | null;
  contract_id: string | null;
  term_years: number;
  tariff: number;
  currency_code: string;
  escalation_pct: number;
  capacity_mw: number | null;
  annual_energy_mwh: number | null;
  availability_target_pct: number | null;
  liquidated_damages: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LcoeRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  capex: number;
  opex_annual: number;
  discount_rate_pct: number;
  annual_energy_mwh: number;
  degradation_pct: number;
  project_life_years: number;
  currency_code: string;
  lcoe: number | null;
  assumptions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DdItemRow {
  id: string;
  company_id: string;
  project_id: string;
  category: DdCategory | string;
  title: string;
  description: string | null;
  status: DdItemStatus;
  due_date: string | null;
  owner_id: string | null;
  document_path: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankFacilityRow {
  id: string;
  company_id: string;
  project_id: string | null;
  lender_name: string;
  facility_type: FacilityType;
  commitment_amount: number;
  drawn_amount: number;
  currency_code: string;
  interest_rate_pct: number | null;
  margin_pct: number | null;
  maturity_date: string | null;
  covenants: Array<{
    name: string;
    threshold?: string | number | null;
    measured_at?: string | null;
    status?: string | null;
  }>;
  status: FacilityStatus | string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const PpaUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  counterparty: z.string().max(200).nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  term_years: z.number().int().positive().max(100),
  tariff: z.number().nonnegative().finite(),
  currency_code: z.string().length(3),
  escalation_pct: z.number().min(-50).max(50).default(0),
  capacity_mw: z.number().nonnegative().nullable().optional(),
  annual_energy_mwh: z.number().nonnegative().nullable().optional(),
  availability_target_pct: z.number().min(0).max(100).nullable().optional(),
  liquidated_damages: z.record(z.string(), z.any()).default({}),
  notes: z.string().max(4000).nullable().optional(),
});
export type PpaUpsertInput = z.infer<typeof PpaUpsertSchema>;

export const LcoeUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  capex: z.number().nonnegative().finite(),
  opex_annual: z.number().nonnegative().finite(),
  discount_rate_pct: z.number().min(0).max(50),
  annual_energy_mwh: z.number().positive().finite(),
  degradation_pct: z.number().min(0).max(50).default(0.5),
  project_life_years: z.number().int().positive().max(60).default(25),
  currency_code: z.string().length(3),
  assumptions: z.record(z.string(), z.any()).default({}),
});
export type LcoeUpsertInput = z.infer<typeof LcoeUpsertSchema>;

export const DdUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  category: z.enum(DD_CATEGORIES),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  due_date: z.string().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  response_note: z.string().max(4000).nullable().optional(),
  document_path: z.string().max(1024).nullable().optional(),
});
export type DdUpsertInput = z.infer<typeof DdUpsertSchema>;

export const DdStatusChangeSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(DD_ITEM_STATUSES),
  note: z.string().max(2000).optional(),
});
export type DdStatusChangeInput = z.infer<typeof DdStatusChangeSchema>;

export const CovenantSchema = z.object({
  name: z.string().min(1).max(200),
  threshold: z.union([z.string(), z.number()]).nullable().optional(),
  measured_at: z.string().nullable().optional(),
  status: z.string().max(80).nullable().optional(),
});
export type Covenant = z.infer<typeof CovenantSchema>;

export const FacilityUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid().nullable().optional(),
  lender_name: z.string().min(1).max(200),
  facility_type: z.enum(FACILITY_TYPES),
  commitment_amount: z.number().positive().finite(),
  drawn_amount: z.number().nonnegative().finite().default(0),
  currency_code: z.string().length(3),
  interest_rate_pct: z.number().min(0).max(100).nullable().optional(),
  margin_pct: z.number().min(-100).max(100).nullable().optional(),
  maturity_date: z.string().nullable().optional(),
  covenants: z.array(CovenantSchema).default([]),
  status: z.enum(FACILITY_STATUSES).default("active"),
});
export type FacilityUpsertInput = z.infer<typeof FacilityUpsertSchema>;

export const FacilityDrawdownSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().positive().finite(),
  note: z.string().max(2000).optional(),
});
export type FacilityDrawdownInput = z.infer<typeof FacilityDrawdownSchema>;

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/** Year-1 PPA revenue in the same currency as the tariff. */
export function ppaYearOneRevenue(
  tariff: number,
  annualEnergyMwh: number | null | undefined,
): number {
  if (!annualEnergyMwh || annualEnergyMwh <= 0) return 0;
  return tariff * annualEnergyMwh;
}

export interface ComputeLcoeInput {
  capex: number;
  opex_annual: number;
  /** Percent, e.g. `7` for 7%. */
  discount_rate_pct: number;
  annual_energy_mwh: number;
  /** Percent per year, e.g. `0.5` for 0.5%. */
  degradation_pct: number;
  project_life_years: number;
}

/**
 * Discounted-numerator / discounted-denominator LCOE.
 *
 *  LCOE = ( capex + Σ opex_annual / (1+r)^t )
 *         ------------------------------------
 *         Σ ( energy · (1−d)^(t-1) / (1+r)^t )
 *
 * Returns cost per MWh (same currency as capex/opex).
 */
export function computeLcoe(input: ComputeLcoeInput): number {
  const {
    capex,
    opex_annual,
    discount_rate_pct,
    annual_energy_mwh,
    degradation_pct,
    project_life_years,
  } = input;

  if (!(annual_energy_mwh > 0)) {
    throw new Error("annual_energy_mwh must be positive");
  }
  if (!(project_life_years >= 1)) {
    throw new Error("project_life_years must be >= 1");
  }
  if (discount_rate_pct < 0) {
    throw new Error("discount_rate_pct must be >= 0");
  }

  const r = discount_rate_pct / 100;
  const d = degradation_pct / 100;

  let numerator = capex;
  let denominator = 0;
  for (let t = 1; t <= project_life_years; t++) {
    const df = Math.pow(1 + r, t);
    numerator += opex_annual / df;
    const energyT = annual_energy_mwh * Math.pow(1 - d, t - 1);
    denominator += energyT / df;
  }
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// Facility utilization
// ---------------------------------------------------------------------------
export function facilityUtilizationPct(
  drawn: number,
  commitment: number,
): number {
  if (commitment <= 0) return 0;
  return (drawn / commitment) * 100;
}

export function assertDrawdownAllowed(
  drawn: number,
  amount: number,
  commitment: number,
): void {
  if (!(amount > 0)) throw new Error("drawdown_amount_must_be_positive");
  if (drawn + amount > commitment + 0.005) {
    throw new Error("drawdown_exceeds_commitment");
  }
}

// ---------------------------------------------------------------------------
// DD readiness
// ---------------------------------------------------------------------------
export interface DdReadinessSummary {
  total: number;
  accepted: number;
  waived: number;
  submitted: number;
  in_progress: number;
  not_started: number;
  readinessPct: number;
}

export function ddReadinessSummary(
  items: ReadonlyArray<Pick<DdItemRow, "status">>,
): DdReadinessSummary {
  const counts: Record<DdItemStatus, number> = {
    not_started: 0,
    in_progress: 0,
    submitted: 0,
    accepted: 0,
    waived: 0,
  };
  for (const it of items) {
    counts[it.status as DdItemStatus] =
      (counts[it.status as DdItemStatus] ?? 0) + 1;
  }
  const total = items.length;
  const done = counts.accepted + counts.waived;
  return {
    total,
    accepted: counts.accepted,
    waived: counts.waived,
    submitted: counts.submitted,
    in_progress: counts.in_progress,
    not_started: counts.not_started,
    readinessPct: total === 0 ? 0 : (done / total) * 100,
  };
}

export type ReadinessBucket = "ok" | "warn";

export function ddReadinessBucket(pct: number): ReadinessBucket {
  return pct >= 80 ? "ok" : "warn";
}

/** True when due date is strictly before today (UTC) and the item is still open. */
export function isDdOverdue(
  dueDate: string | null | undefined,
  status: DdItemStatus,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false;
  if (status === "accepted" || status === "waived") return false;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const due = new Date(`${dueDate}T00:00:00Z`);
  return due.getTime() < today.getTime();
}
