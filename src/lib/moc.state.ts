// P-192 — Pure mirror of the 0078 MOC state machine (SQL-equivalent, testable).
import type { CrStatus } from "@/lib/moc.rules";

export const ALLOWED_TRANSITIONS: Record<CrStatus, CrStatus[]> = {
  draft: ["assessment", "cancelled"],
  assessment: ["approved", "rejected", "cancelled"],
  approved: ["implementing", "cancelled"],
  implementing: ["closed"],
  closed: [],
  rejected: [],
  cancelled: [],
};

export type TransitionError =
  | "not_authenticated"
  | "forbidden"
  | "invalid_transition"
  | "approval_not_complete"
  | "rejection_reason_required"
  | "implementation_evidence_required"
  | "closure_notes_required";

export interface TransitionInput {
  from: CrStatus;
  to: CrStatus;
  authenticated?: boolean;
  isMember?: boolean;
  /** Status of the linked approval instance, if any. */
  approvalStatus?: string | null;
  rejectionReason?: string | null;
  evidenceCount?: number;
  closureNotes?: string | null;
  isOriginator?: boolean;
  isCompanyAdmin?: boolean;
}

export type TransitionResult =
  | { ok: true; status: CrStatus; idempotent: boolean }
  | { ok: false; error: TransitionError };

/** Mirrors `transition_change_request` + the `guard_cr_status` trigger. */
export function evaluateTransition(input: TransitionInput): TransitionResult {
  const {
    from,
    to,
    authenticated = true,
    isMember = true,
    approvalStatus = null,
    rejectionReason = null,
    evidenceCount = 0,
    closureNotes = null,
    isOriginator = false,
    isCompanyAdmin = false,
  } = input;

  if (!authenticated) return { ok: false, error: "not_authenticated" };
  if (!isMember) return { ok: false, error: "forbidden" };
  if (from === to) return { ok: true, status: from, idempotent: true };
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to))
    return { ok: false, error: "invalid_transition" };

  if (to === "approved" && approvalStatus !== "approved")
    return { ok: false, error: "approval_not_complete" };

  if (to === "rejected" && approvalStatus !== "rejected" && !rejectionReason?.trim())
    return { ok: false, error: "rejection_reason_required" };

  if (to === "closed") {
    if (evidenceCount <= 0) return { ok: false, error: "implementation_evidence_required" };
    if (!closureNotes?.trim()) return { ok: false, error: "closure_notes_required" };
  }

  if (to === "cancelled" && !isOriginator && !isCompanyAdmin)
    return { ok: false, error: "forbidden" };

  return { ok: true, status: to, idempotent: false };
}

/** Mirrors `next_cr_number`: a per-company counter formatted CR-0007. */
export function nextCrNumber(lastNumber: number): string {
  const n = Math.max(0, Math.floor(lastNumber)) + 1;
  return `CR-${String(n).padStart(4, "0")}`;
}

/** Mirrors the rule-key pick in `submit_change_request`. */
export function resolveMocRuleKey(changeType: string, activeRuleKeys: readonly string[]): string {
  const specific = `moc_${changeType}`;
  return activeRuleKeys.includes(specific) ? specific : "moc_default";
}

/** Mirrors the draft-completeness guard before submission. */
export function canSubmitChangeRequest(cr: {
  status: string;
  description?: string | null;
  reason?: string | null;
}): { ok: boolean; error?: "description_and_reason_required"; idempotent?: boolean } {
  if (cr.status !== "draft") return { ok: true, idempotent: true };
  if (!cr.description?.trim() || !cr.reason?.trim())
    return { ok: false, error: "description_and_reason_required" };
  return { ok: true, idempotent: false };
}
