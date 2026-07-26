// P-186 — Pure permit-to-work validity helpers.
// Zero React / Supabase imports: deterministic and unit-testable.
import { evaluatePtwValidity, type PtwStatus } from "@/lib/governance.rules";

export type PermitRow = {
  status: PtwStatus | string;
  valid_from: string;
  valid_to: string;
  isolations_confirmed: boolean;
};

function toInput(permit: PermitRow) {
  return {
    status: permit.status as PtwStatus,
    validFrom: permit.valid_from,
    validTo: permit.valid_to,
    isolationsConfirmed: permit.isolations_confirmed === true,
  };
}

/**
 * A permit is valid iff it is active, now is inside [valid_from, valid_to)
 * and its isolations are confirmed.
 */
export function isPermitValid(permit: PermitRow, now: Date | number = Date.now()): boolean {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return evaluatePtwValidity(toInput(permit), nowMs).usable;
}

/** Lazy expiry sweep (P-182): a live permit past valid_to derives 'expired'. */
export function permitDerivedStatus(
  permit: PermitRow,
  now: Date | number = Date.now(),
): PtwStatus | string {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return evaluatePtwValidity(toInput(permit), nowMs).effectiveStatus;
}
