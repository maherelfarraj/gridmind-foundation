// P-146 — Pure SLD status machine. No React/Supabase imports (unit-testable).
// The server fn is the only authority; this module encodes the rules both
// sides share so the UI can explain *why* a target is unavailable.

export const SLD_STATUSES = [
  "draft",
  "under_review",
  "approved",
  "ifc",
  "as_built",
  "superseded",
] as const;

export type SldStatus = (typeof SLD_STATUSES)[number];

/** Structural edges of the machine (guards are evaluated separately). */
export const SLD_TRANSITIONS: Record<SldStatus, SldStatus[]> = {
  draft: ["under_review"],
  under_review: ["approved"],
  approved: ["ifc", "superseded"],
  ifc: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

export type TransitionContext = {
  current: SldStatus;
  /** Live object count on the current revision (removed objects excluded). */
  objectCount: number;
  /** A validation snapshot exists for the current revision. */
  hasValidation: boolean;
  /** Error-severity issues from the last validation run. */
  errorCount: number;
  /** Reviewer signoffs still open (no decision, not waived). */
  openSignoffs: number;
  /** Status of the sld_drawing_approval instance for this drawing, if any. */
  approvalStatus: "none" | "pending" | "in_progress" | "approved" | "rejected" | "cancelled";
  isEngineeringAdmin: boolean;
  /** metadata.replacement_drawing_id supplied by the caller. */
  hasReplacement: boolean;
};

export type TransitionCheck = {
  target: SldStatus;
  allowed: boolean;
  /** Machine-readable denial code, null when allowed. */
  code: string | null;
  /** Human explanation shown in the tooltip. */
  reason: string | null;
};

export function isStructurallyAllowed(from: SldStatus, to: SldStatus): boolean {
  return (SLD_TRANSITIONS[from] ?? []).includes(to);
}

function ok(target: SldStatus): TransitionCheck {
  return { target, allowed: true, code: null, reason: null };
}

function deny(target: SldStatus, code: string, reason: string): TransitionCheck {
  return { target, allowed: false, code, reason };
}

/** Evaluates one transition against the full guard set. */
export function checkTransition(ctx: TransitionContext, target: SldStatus): TransitionCheck {
  if (!isStructurallyAllowed(ctx.current, target)) {
    return deny(
      target,
      "invalid_transition",
      `"${ctx.current}" cannot move directly to "${target}".`,
    );
  }

  if (target === "under_review") {
    if (ctx.objectCount < 1) {
      return deny(target, "empty_drawing", "Place at least one object before requesting review.");
    }
    if (!ctx.hasValidation) {
      return deny(target, "validation_required", "Run validation on this revision first.");
    }
    return ok(target);
  }

  if (target === "approved") {
    if (ctx.errorCount > 0) {
      return deny(
        target,
        "validation_errors",
        `${ctx.errorCount} error-severity validation issue(s) must be resolved.`,
      );
    }
    if (ctx.openSignoffs > 0) {
      return deny(
        target,
        "open_signoffs",
        `${ctx.openSignoffs} reviewer signoff(s) are still open or unwaived.`,
      );
    }
    if (ctx.approvalStatus === "rejected") {
      return deny(target, "approval_rejected", "The approval instance was rejected.");
    }
    if (ctx.approvalStatus === "pending" || ctx.approvalStatus === "in_progress") {
      return deny(target, "approval_pending", "Approval is in progress — waiting on approvers.");
    }
    if (ctx.approvalStatus === "none" && !ctx.isEngineeringAdmin) {
      return deny(
        target,
        "approval_required",
        "Requesting approval starts the sld_drawing_approval workflow.",
      );
    }
    return ok(target);
  }

  if (target === "ifc") {
    if (!ctx.isEngineeringAdmin) {
      return deny(target, "forbidden", "Only an engineering admin can issue for construction.");
    }
    if (ctx.approvalStatus !== "approved") {
      return deny(target, "approval_incomplete", "A completed approval is required before IFC.");
    }
    return ok(target);
  }

  if (target === "as_built") {
    return ok(target);
  }

  if (target === "superseded") {
    if (!ctx.hasReplacement) {
      return deny(target, "replacement_required", "Reference the replacement drawing first.");
    }
    if (!ctx.isEngineeringAdmin) {
      return deny(target, "forbidden", "Only an engineering admin can supersede a drawing.");
    }
    return ok(target);
  }

  return deny(target, "invalid_transition", "Unsupported transition.");
}

/** Every target of the machine annotated for the status dropdown. */
export function availableTransitions(ctx: TransitionContext): TransitionCheck[] {
  return SLD_STATUSES.filter((s) => s !== ctx.current).map((s) => {
    if (!isStructurallyAllowed(ctx.current, s)) {
      return deny(s, "invalid_transition", `"${ctx.current}" cannot move directly to "${s}".`);
    }
    return checkTransition(ctx, s);
  });
}
