// P-108 — Warranty & claims pure schemas and status helpers.
import { z } from "zod";

export const WARRANTY_TYPES = [
  "manufacturer",
  "epc_workmanship",
  "extended",
  "performance",
] as const;
export type WarrantyType = (typeof WARRANTY_TYPES)[number];

export const WARRANTY_CLAIM_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "settled",
] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

export const EXPIRING_SOON_DAYS = 90;

export function daysRemaining(endDateISO: string, today: Date = new Date()): number {
  const end = new Date(`${endDateISO}T00:00:00Z`).getTime();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((end - now) / 86_400_000);
}

export type WarrantyStatusBadge = "active" | "expiring" | "expired";

export function warrantyStatusBadge(days: number): WarrantyStatusBadge {
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return "active";
}

// ---- upsert / claim schemas ------------------------------------------------
export const warrantyContractUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    project_id: z.string().uuid(),
    equipment_id: z.string().uuid().nullable().optional(),
    vendor_id: z.string().uuid().nullable().optional(),
    warranty_type: z.enum(WARRANTY_TYPES),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    terms: z.string().trim().max(4000).nullable().optional(),
    coverage_notes: z.string().trim().max(4000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.end_date < v.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_date"],
        message: "end_date must be on or after start_date",
      });
    }
  });
export type WarrantyContractUpsertInput = z.infer<typeof warrantyContractUpsertSchema>;

export const warrantyClaimCreateSchema = z.object({
  warranty_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  claimed_amount: z.number().finite().min(0).nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  override_note: z.string().trim().min(3).max(500).nullable().optional(),
});
export type WarrantyClaimCreateInput = z.infer<typeof warrantyClaimCreateSchema>;

export const claimAdvanceSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["submitted", "under_review", "approved", "rejected"]),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ClaimAdvanceInput = z.infer<typeof claimAdvanceSchema>;

export const claimSettleSchema = z.object({
  id: z.string().uuid(),
  settled_amount: z.number().finite().min(0),
  currency_code: z.string().length(3).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ClaimSettleInput = z.infer<typeof claimSettleSchema>;

// ---- guard used by both server & client for optimistic UX -----------------
export interface ClaimableGuardResult {
  ok: boolean;
  code?: "expired_warranty_no_override" | "expired_override_note_required";
}

export function checkWarrantyClaimable(opts: {
  end_date: string;
  isOmAdmin: boolean;
  override_note?: string | null;
  today?: Date;
}): ClaimableGuardResult {
  const days = daysRemaining(opts.end_date, opts.today ?? new Date());
  if (days >= 0) return { ok: true };
  if (!opts.isOmAdmin) return { ok: false, code: "expired_warranty_no_override" };
  const note = (opts.override_note ?? "").trim();
  if (note.length < 3) return { ok: false, code: "expired_override_note_required" };
  return { ok: true };
}

// ---- claim state graph -----------------------------------------------------
const ALLOWED: Record<WarrantyClaimStatus, readonly WarrantyClaimStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["settled"],
  rejected: [],
  settled: [],
};

export function canAdvanceClaim(from: WarrantyClaimStatus, to: WarrantyClaimStatus): boolean {
  return ALLOWED[from].includes(to);
}
