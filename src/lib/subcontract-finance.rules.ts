// P-261 — Subcontractor money loop: certified claim → AP invoice → payment.
// Pure math mirroring the SQL in 0101_subcontract_finance.sql so the UI can
// pre-validate before the database guards fire.
import { z } from "zod";

const toCents = (n: number) => Math.round(Number(n || 0) * 100);
const fromCents = (c: number) => c / 100;
export const round2 = (n: number) => fromCents(toCents(n));

/** NET-30 default (the Day-3 doctrine) unless the subcontract says otherwise. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/** AP series is dedicated (AP-####), never sharing the receivable INV-#### run. */
export const AP_INVOICE_PREFIX = "AP-";

export function apInvoiceNumber(sequence: number): string {
  return `${AP_INVOICE_PREFIX}${String(Math.max(1, Math.trunc(sequence))).padStart(4, "0")}`;
}

export function isApInvoiceNumber(value: string | null | undefined): boolean {
  return /^AP-\d{4,}$/.test(String(value ?? ""));
}

/** due_date = issue_date + payment terms (days). */
export function apDueDate(issueDate: string, paymentTermsDays?: number | null): string {
  const days =
    paymentTermsDays != null && Number.isFinite(Number(paymentTermsDays))
      ? Math.max(0, Math.trunc(Number(paymentTermsDays)))
      : DEFAULT_PAYMENT_TERMS_DAYS;
  const d = new Date(`${issueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The AP invoice carries the NET payable only — retention stays visible on the
 * subcontract ledger, never on the invoice.
 */
export function apInvoiceAmount(claim: { net_payable: number }): number {
  return round2(claim.net_payable);
}

// ---------------------------------------------------------------------------
// Retention ledger
// ---------------------------------------------------------------------------
export interface RetentionLedgerInput {
  /** retention_amount of every certified claim. */
  certifiedRetention: readonly number[];
  /** amounts already released (release ledger rows + claim-level releases). */
  releases: readonly number[];
}

export interface RetentionLedger {
  retained: number;
  released: number;
  held: number;
  fullyReleased: boolean;
}

export function retentionLedger(input: RetentionLedgerInput): RetentionLedger {
  const retained = input.certifiedRetention.reduce((a, n) => a + toCents(n), 0);
  const released = input.releases.reduce((a, n) => a + toCents(n), 0);
  const held = retained - released;
  return {
    retained: fromCents(retained),
    released: fromCents(released),
    held: fromCents(held),
    fullyReleased: held === 0 && retained > 0,
  };
}

export type RetentionReleaseCheck =
  | { ok: true }
  | { ok: false; reason: "amount_invalid" | "exceeds_held" | "before_dlp" };

/** Client-side mirror of `subcontract_release_retention()` guards. */
export function checkRetentionRelease(input: {
  amount: number;
  retentionHeld: number;
  defectsLiabilityEnd: string | null;
  releaseDate: string;
  canOverrideDlp: boolean;
}): RetentionReleaseCheck {
  if (!(Number(input.amount) > 0)) return { ok: false, reason: "amount_invalid" };
  if (toCents(input.amount) > toCents(input.retentionHeld)) {
    return { ok: false, reason: "exceeds_held" };
  }
  const dlpPassed = !!input.defectsLiabilityEnd && input.defectsLiabilityEnd <= input.releaseDate;
  if (!dlpPassed && !input.canOverrideDlp) return { ok: false, reason: "before_dlp" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WIP / EVM reflection
// ---------------------------------------------------------------------------
/** Certified sub-claim value that flows into project actual cost (gross, pre-retention). */
export function certifiedSubActuals(
  claims: readonly { status: string; certified_at: string | null; this_period_amount: number }[],
  asOfDate: string,
): number {
  return fromCents(
    claims
      .filter(
        (c) =>
          c.status === "certified" &&
          !!c.certified_at &&
          String(c.certified_at).slice(0, 10) <= asOfDate,
      )
      .reduce((a, c) => a + toCents(c.this_period_amount), 0),
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RetentionReleaseSchema = z.object({
  subcontract_id: z.string().uuid(),
  amount: z.number().finite().positive().max(1e12),
  release_date: dateStr.optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});
export type RetentionReleaseInput = z.infer<typeof RetentionReleaseSchema>;
