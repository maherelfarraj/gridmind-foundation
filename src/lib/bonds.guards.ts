// P-206 — Pure server-side guards for the bond lifecycle.
//
// Every mutation in bonds.functions.ts runs its decision through one of these
// helpers so the enforcement matrix is testable offline (tests/bonds) instead
// of only reachable through a live server function + database.
//
// A guard returns `null` when the action is allowed, or a typed failure the
// caller converts into httpError(status, code, message, meta).

import {
  OPEN_CLAIM_STATUSES,
  RELEASABLE_STATUSES,
  RENEWABLE_STATUSES,
  RETURNABLE_STATUSES,
  TERMINAL_BOND_STATUSES,
  activationBlockers,
  isTerminalBondStatus,
  paidTotal,
  type BondStatus,
  type ClaimResolution,
} from "./bonds.rules";

export interface BondGuardError {
  status: 409 | 422;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

const TERMINAL: BondGuardError = {
  status: 409,
  code: "terminal_status",
  message: "This instrument is closed; no further transitions.",
};

export interface GuardInstrument {
  status: BondStatus;
  effective_status: BondStatus;
  amount: number;
  expiry_date: string | null;
  instrument_type: string;
  document_path?: string | null;
  issue_date?: string | null;
  effective_date?: string | null;
}

export interface GuardClaim {
  id: string;
  status: string;
  amount: number;
}

/** Activation requires a document and both dates on file. */
export function guardActivate(instrument: GuardInstrument): BondGuardError | null {
  if (isTerminalBondStatus(instrument.status)) return TERMINAL;
  if (instrument.status !== "draft") {
    return {
      status: 409,
      code: "invalid_transition",
      message: "Only a draft instrument can be activated.",
    };
  }
  const blockers = activationBlockers({
    status: instrument.status,
    document_path: instrument.document_path ?? null,
    issue_date: instrument.issue_date ?? null,
    effective_date: instrument.effective_date ?? null,
    expiry_date: instrument.expiry_date,
  });
  if (blockers.length > 0) {
    return {
      status: 409,
      code: "activation_blocked",
      message: blockers.join(" "),
      meta: { blockers },
    };
  }
  return null;
}

/** A claim may never exceed the instrument, and only one claim may be open. */
export function guardCreateClaim(
  instrument: GuardInstrument,
  claims: GuardClaim[],
  amount: number,
): BondGuardError | null {
  if (amount > instrument.amount) {
    return {
      status: 422,
      code: "claim_exceeds_instrument",
      message: "Claim exceeds instrument amount.",
      meta: { instrument_amount: instrument.amount },
    };
  }
  if (claims.some((c) => OPEN_CLAIM_STATUSES.includes(c.status as never))) {
    return {
      status: 409,
      code: "claim_already_open",
      message: "An open claim already exists on this instrument.",
    };
  }
  return null;
}

/** Σ paid claims can never exceed the instrument amount. */
export function guardResolveClaim(
  instrument: GuardInstrument,
  claim: GuardClaim,
  otherClaims: GuardClaim[],
  outcome: ClaimResolution,
): BondGuardError | null {
  if (!OPEN_CLAIM_STATUSES.includes(claim.status as never)) {
    return {
      status: 409,
      code: "invalid_transition",
      message: "This claim is already resolved.",
    };
  }
  if (outcome === "paid") {
    const already = paidTotal(otherClaims);
    if (already + claim.amount > instrument.amount) {
      return {
        status: 422,
        code: "paid_exceeds_instrument",
        message: "Paid claims would exceed the instrument amount.",
        meta: { instrument_amount: instrument.amount, paid_total: already },
      };
    }
  }
  return null;
}

/** Release always goes through the seeded approval chain — never direct. */
export function guardRequestRelease(
  instrument: GuardInstrument,
  pendingApproval: boolean,
): BondGuardError | null {
  if (isTerminalBondStatus(instrument.status)) return TERMINAL;
  if (!RELEASABLE_STATUSES.includes(instrument.effective_status)) {
    return {
      status: 409,
      code: "invalid_transition",
      message: "Only live or lapsed instruments can be released.",
    };
  }
  if (pendingApproval) {
    return {
      status: 409,
      code: "release_pending",
      message: "A release approval is already pending.",
    };
  }
  return null;
}

/** No seeded rule → refuse; a bond is never released without two approvals. */
export function guardReleaseRule(instanceId: string | null): BondGuardError | null {
  if (instanceId) return null;
  return {
    status: 409,
    code: "no_release_rule",
    message: "Release requires the bond_release approval rule.",
  };
}

export function guardReturn(instrument: GuardInstrument): BondGuardError | null {
  if (instrument.instrument_type !== "bid_bond") {
    return { status: 409, code: "not_a_bid_bond", message: "Only bid bonds can be returned." };
  }
  if (isTerminalBondStatus(instrument.status)) return TERMINAL;
  const effective =
    instrument.effective_status === "expiring_soon" ? "active" : instrument.effective_status;
  if (!RETURNABLE_STATUSES.includes(effective)) {
    return {
      status: 409,
      code: "invalid_transition",
      message: "Only live or lapsed bid bonds can be returned.",
    };
  }
  return null;
}

export function guardCancel(instrument: GuardInstrument): BondGuardError | null {
  return isTerminalBondStatus(instrument.status) ? TERMINAL : null;
}

/** Renewal must move the expiry forward and never resurrect a closed bond. */
export function guardRenew(instrument: GuardInstrument, newExpiry: string): BondGuardError | null {
  if (isTerminalBondStatus(instrument.status)) return TERMINAL;
  if (!RENEWABLE_STATUSES.includes(instrument.effective_status)) {
    return {
      status: 409,
      code: "invalid_transition",
      message: "Only live or lapsed instruments can be renewed.",
    };
  }
  if (instrument.expiry_date && newExpiry <= instrument.expiry_date) {
    return {
      status: 422,
      code: "expiry_not_forward",
      message: "New expiry must be after the current expiry",
      meta: { current_expiry: instrument.expiry_date },
    };
  }
  return null;
}

export const BOND_TERMINAL_STATUSES = TERMINAL_BOND_STATUSES;
