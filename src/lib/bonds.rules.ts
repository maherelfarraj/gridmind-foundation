// P-202 — Bonds & guarantees: pure rules (no I/O). Shared by server fns and UI.
import { z } from "zod";

export const BOND_WRITE_ROLES = ["finance_admin", "legal_admin", "company_admin"] as const;

export const INSTRUMENT_TYPES = [
  "bid_bond",
  "advance_payment_guarantee",
  "performance_bond",
  "retention_bond",
  "warranty_bond",
  "insurance_car_ear",
  "insurance_pi",
  "insurance_pl",
  "workmen_comp",
  "parent_company_guarantee",
  "standby_lc",
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const INSTRUMENT_TYPE_META: Record<InstrumentType, { label: string; description: string }> =
  {
    bid_bond: {
      label: "Bid bond",
      description:
        "Bid bond — guarantees you will sign the contract if your tender wins; typically 1–2% of bid value.",
    },
    advance_payment_guarantee: {
      label: "Advance payment guarantee",
      description:
        "Advance payment guarantee — secures the client's advance until it is repaid through certificates.",
    },
    performance_bond: {
      label: "Performance bond",
      description:
        "Performance bond — guarantees you complete the works; typically 5–15% of contract value.",
    },
    retention_bond: {
      label: "Retention bond",
      description:
        "Retention bond — released cash retention against a bank guarantee so money stays in your account.",
    },
    warranty_bond: {
      label: "Warranty bond",
      description:
        "Warranty bond — covers defects during the warranty period after taking-over/PAC.",
    },
    insurance_car_ear: {
      label: "CAR / EAR insurance",
      description:
        "Contractor's / erection all-risks insurance — covers physical loss or damage on site during construction.",
    },
    insurance_pi: {
      label: "Professional indemnity",
      description:
        "Professional indemnity — covers claims arising from design or engineering errors and omissions.",
    },
    insurance_pl: {
      label: "Public liability",
      description:
        "Public liability — covers third-party injury or property damage caused by the works.",
    },
    workmen_comp: {
      label: "Workmen's compensation",
      description: "Workmen's compensation — statutory cover for injury to your own workforce.",
    },
    parent_company_guarantee: {
      label: "Parent company guarantee",
      description:
        "Parent company guarantee — the parent underwrites your obligations; no bank margin consumed.",
    },
    standby_lc: {
      label: "Standby letter of credit",
      description:
        "Standby LC — a bank undertaking payable on demand if you fail to meet the contract obligation.",
    },
  };

export const BENEFICIARY_TYPES = [
  "client",
  "supplier",
  "subcontractor",
  "employer",
  "utility",
  "other",
] as const;
export type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number];

export const ISSUER_TYPES = ["bank", "insurance_company"] as const;
export type IssuerType = (typeof ISSUER_TYPES)[number];

export const BOND_STATUSES = [
  "draft",
  "active",
  "expiring_soon",
  "expired",
  "released",
  "claimed",
  "returned",
  "cancelled",
] as const;
export type BondStatus = (typeof BOND_STATUSES)[number];

export const OUTSTANDING_CLAIM_STATUSES = ["submitted", "contested"] as const;
export const COVERAGE_STATUSES: readonly BondStatus[] = ["active", "expiring_soon"];

export function titleize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function instrumentTypeLabel(t: string): string {
  return INSTRUMENT_TYPE_META[t as InstrumentType]?.label ?? titleize(t);
}

export const FORMULAS = {
  coverage:
    "active coverage = Σ amount where status ∈ (active, expiring_soon), grouped per currency — never converted",
  expiring30: "count of instruments where 0 ≤ expiry_date − today ≤ 30",
  expiring90: "count of instruments where 0 ≤ expiry_date − today ≤ 90",
  claims: "count of bond_claims where status ∈ (submitted, contested)",
  countdown: "days_to_expiry = expiry_date − current_date",
} as const;

const MS_DAY = 86_400_000;

/** days_to_expiry = expiry_date − current_date (whole days, UTC). */
export function daysToExpiry(expiry: string | null, today: string): number | null {
  if (!expiry) return null;
  const a = Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / MS_DAY);
}

export type CountdownTone = "good" | "warning" | "bad" | "neutral";

/** > 90d green, ≤ 90d amber, ≤ 30d or expired destructive. */
export function countdownTone(days: number | null): CountdownTone {
  if (days === null) return "neutral";
  if (days < 0 || days <= 30) return "bad";
  if (days <= 90) return "warning";
  return "good";
}

export function countdownLabel(days: number | null): string {
  if (days === null) return "No expiry";
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `${days}d left`;
}

/**
 * Effective status for display only. The P-203 cron materializes these to the
 * database; the UI never writes them.
 */
export function effectiveStatus(status: BondStatus, days: number | null): BondStatus {
  if (status !== "active" && status !== "expiring_soon") return status;
  if (days === null) return status;
  if (days < 0) return "expired";
  if (days <= 90) return "expiring_soon";
  return "active";
}

export interface BondRow {
  id: string;
  instrument_number: string;
  instrument_type: InstrumentType;
  beneficiary_name: string;
  beneficiary_type: BeneficiaryType;
  issuer_name: string;
  issuer_type: IssuerType;
  principal_name: string | null;
  project_id: string | null;
  project_name: string | null;
  contract_id: string | null;
  amount: number;
  currency_code: string;
  premium_pct: number | null;
  issue_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  status: BondStatus;
  effective_status: BondStatus;
  days_to_expiry: number | null;
  auto_renew: boolean;
  document_path: string | null;
  notes: string | null;
  created_at: string;
}

export interface CoverageSlice {
  currency_code: string;
  amount: number;
}

export interface BondKpis {
  coverage: CoverageSlice[];
  expiring_30: number;
  expiring_90: number;
  claims_outstanding: number;
}

export function coverageByCurrency(rows: BondRow[]): CoverageSlice[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!COVERAGE_STATUSES.includes(r.effective_status)) continue;
    map.set(r.currency_code, (map.get(r.currency_code) ?? 0) + Number(r.amount ?? 0));
  }
  return [...map.entries()]
    .map(([currency_code, amount]) => ({ currency_code, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function expiringWithin(rows: BondRow[], days: number): number {
  return rows.filter((r) => {
    if (!COVERAGE_STATUSES.includes(r.effective_status)) return false;
    return r.days_to_expiry !== null && r.days_to_expiry >= 0 && r.days_to_expiry <= days;
  }).length;
}

export function computeKpis(rows: BondRow[], claimsOutstanding: number): BondKpis {
  return {
    coverage: coverageByCurrency(rows),
    expiring_30: expiringWithin(rows, 30),
    expiring_90: expiringWithin(rows, 90),
    claims_outstanding: claimsOutstanding,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const ListBondsSchema = z.object({
  instrument_type: z.enum(INSTRUMENT_TYPES).optional(),
  status: z.enum(BOND_STATUSES).optional(),
  project_id: z.string().uuid().optional(),
  issuer: z.string().trim().max(160).optional(),
});
export type ListBondsInput = z.infer<typeof ListBondsSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const CreateBondSchema = z
  .object({
    instrument_type: z.enum(INSTRUMENT_TYPES),
    beneficiary_name: z.string().trim().min(1).max(200),
    beneficiary_type: z.enum(BENEFICIARY_TYPES),
    issuer_name: z.string().trim().min(1).max(200),
    issuer_type: z.enum(ISSUER_TYPES),
    principal_name: z.string().trim().max(200).optional(),
    amount: z.number().finite().positive(),
    currency_code: z.string().trim().min(3).max(8),
    premium_pct: z.number().finite().min(0).max(100).optional(),
    issue_date: isoDate,
    effective_date: isoDate.optional(),
    expiry_date: isoDate.optional(),
    auto_renew: z.boolean().default(false),
    project_id: z.string().uuid().optional(),
    contract_id: z.string().uuid().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => !v.expiry_date || v.expiry_date >= v.issue_date, {
    path: ["expiry_date"],
    message: "Expiry date must be on or after the issue date.",
  })
  .refine((v) => !v.expiry_date || !v.effective_date || v.effective_date <= v.expiry_date, {
    path: ["effective_date"],
    message: "Effective date must be on or before the expiry date.",
  });
export type CreateBondInput = z.infer<typeof CreateBondSchema>;

export const BondIdSchema = z.object({ instrument_id: z.string().uuid() });

export const UploadBondDocSchema = z.object({
  instrument_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(160),
  content_base64: z.string().min(1),
  content_type: z.string().trim().max(120).optional(),
});

/** Activation preconditions — mirrored server-side, surfaced as a typed 409. */
export function activationBlockers(row: {
  status: BondStatus;
  document_path: string | null;
  issue_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
}): string[] {
  const blockers: string[] = [];
  if (!row.document_path) blockers.push("Upload the signed instrument document.");
  if (!row.issue_date) blockers.push("Issue date is required.");
  if (!row.effective_date) blockers.push("Effective date is required.");
  if (!row.expiry_date) blockers.push("Expiry date is required.");
  return blockers;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "document";
}

export function bondDocumentPath(companyId: string, instrumentId: string, filename: string) {
  return `${companyId}/bonds/${instrumentId}/${sanitizeFilename(filename)}`;
}

// ---------------------------------------------------------------------------
// P-204 — claims + release/return/cancel rules
// ---------------------------------------------------------------------------
export const CLAIM_STATUSES = [
  "draft",
  "submitted",
  "contested",
  "paid",
  "rejected",
  "withdrawn",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** A claim in one of these states blocks a second claim on the instrument. */
export const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = ["draft", "submitted", "contested"];

export const CLAIM_RESOLUTIONS = ["contested", "paid", "rejected", "withdrawn"] as const;
export type ClaimResolution = (typeof CLAIM_RESOLUTIONS)[number];

/** Outcomes that close the claim (resolved_at set). */
export const TERMINAL_CLAIM_STATUSES: readonly ClaimStatus[] = ["paid", "rejected", "withdrawn"];

/** Instrument statuses that reject every further transition. */
export const TERMINAL_BOND_STATUSES: readonly BondStatus[] = ["released", "returned", "cancelled"];

export function isTerminalBondStatus(status: BondStatus): boolean {
  return TERMINAL_BOND_STATUSES.includes(status);
}

/** Release may be requested from live or lapsed instruments only. */
export const RELEASABLE_STATUSES: readonly BondStatus[] = ["active", "expiring_soon", "expired"];

/** Bid bonds only, and only while live or lapsed. */
export const RETURNABLE_STATUSES: readonly BondStatus[] = ["active", "expired"];

export function paidTotal(claims: { status: string; amount: number }[]): number {
  return claims
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
}

const reason = z.string().trim().min(3, "A reason is required.").max(2000);
const claimIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const CreateClaimSchema = z.object({
  instrument_id: z.string().uuid(),
  amount: z.number().finite().positive(),
  currency_code: z.string().trim().min(3).max(8),
  reason,
  claim_date: claimIsoDate,
});
export type CreateClaimInput = z.infer<typeof CreateClaimSchema>;

export const ClaimIdSchema = z.object({ claim_id: z.string().uuid() });

export const ResolveClaimSchema = z
  .object({
    claim_id: z.string().uuid(),
    outcome: z.enum(CLAIM_RESOLUTIONS),
    resolution_notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      !["paid", "rejected"].includes(v.outcome) || (v.resolution_notes ?? "").trim().length >= 3,
    {
      message: "Resolution notes are mandatory for paid or rejected claims.",
      path: ["resolution_notes"],
    },
  );
export type ResolveClaimInput = z.infer<typeof ResolveClaimSchema>;

export const BondReasonSchema = z.object({
  instrument_id: z.string().uuid(),
  reason,
});
export type BondReasonInput = z.infer<typeof BondReasonSchema>;
