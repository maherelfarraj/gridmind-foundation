// P-259 — Sub portal (external half): pure rules shared by client and server.
//
// The server-side authority is `sub_portal_submit_claim` + the
// `subcontract_claim_lines_derive` trigger; everything here is a mirror so the
// subcontractor sees the failure before the round trip.
import { z } from "zod";

import { round2 } from "@/lib/subcontracts.rules";

export type SubPortalErrorCode =
  | "vendor_portal_access_denied"
  | "subcontract_not_active"
  | "invalid_period"
  | "lines_required"
  | "claim_already_open"
  | "claim_cumulative_out_of_range"
  | "line_not_on_subcontract"
  | "message_required";

export interface SubPortalSovLine {
  id: string;
  line_no: number;
  description: string;
  uom: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  /** cumulative % already certified on prior claims */
  certified_pct: number;
  /** % sitting in a draft/submitted claim */
  pending_pct: number;
}

export interface SubPortalClaimLineInput {
  subcontract_line_id: string;
  this_period_pct: number;
}

/** Remaining head-room for this period on a line (0..100). */
export function remainingPct(line: Pick<SubPortalSovLine, "certified_pct">): number {
  return round2(Math.max(0, 100 - (Number(line.certified_pct) || 0)));
}

/** Mirror of the derive trigger's 0..100 cumulative clamp. */
export function validateClaimLine(
  line: Pick<SubPortalSovLine, "certified_pct">,
  thisPeriodPct: number,
): SubPortalErrorCode | null {
  const pct = Number(thisPeriodPct);
  if (!Number.isFinite(pct) || pct < 0) return "claim_cumulative_out_of_range";
  if (round2((Number(line.certified_pct) || 0) + pct) > 100) {
    return "claim_cumulative_out_of_range";
  }
  return null;
}

export function validateClaimPeriod(start: string, end: string): SubPortalErrorCode | null {
  if (!start || !end) return "invalid_period";
  if (end < start) return "invalid_period";
  return null;
}

/** Non-zero lines only — a claim of all zeros is refused server-side too. */
export function claimPayloadLines(
  entries: readonly SubPortalClaimLineInput[],
): SubPortalClaimLineInput[] {
  return entries
    .filter((l) => Number(l.this_period_pct) > 0)
    .map((l) => ({
      subcontract_line_id: l.subcontract_line_id,
      this_period_pct: round2(Number(l.this_period_pct)),
    }));
}

export interface SubPortalClaimPreview {
  thisPeriodAmount: number;
  retentionAmount: number;
  netPayable: number;
}

/** Client-side preview of what the claim is worth (server recomputes). */
export function previewSubClaim(
  lines: readonly SubPortalSovLine[],
  entries: Readonly<Record<string, number>>,
  retentionPct: number,
): SubPortalClaimPreview {
  const gross = lines.reduce((sum, l) => {
    const pct = Number(entries[l.id] ?? 0);
    if (!Number.isFinite(pct) || pct <= 0) return sum;
    return sum + (Number(l.amount) || 0) * (pct / 100);
  }, 0);
  const thisPeriodAmount = round2(gross);
  const retentionAmount = round2(thisPeriodAmount * ((Number(retentionPct) || 0) / 100));
  return {
    thisPeriodAmount,
    retentionAmount,
    netPayable: round2(thisPeriodAmount - retentionAmount),
  };
}

export const SubPortalClaimSchema = z.object({
  subcontractId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        subcontract_line_id: z.string().uuid(),
        this_period_pct: z.number().min(0).max(100),
      }),
    )
    .min(1),
});
export type SubPortalClaimInput = z.infer<typeof SubPortalClaimSchema>;

/** A sub can only act on a claim it has not submitted yet — proven server-side. */
export function subCanEditClaim(status: string): boolean {
  return status === "draft";
}
