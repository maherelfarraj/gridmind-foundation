// P-058 — Pure review-workflow helpers (shared by server + UI).

export type ReviewDecision =
  | "approved"
  | "approved_with_comments"
  | "rejected"
  | "waived"
  | null;

export interface SignoffRow {
  decision: ReviewDecision;
}

/** All signoffs must have a non-null decision to consider the round complete. */
export function roundIsComplete(signoffs: readonly SignoffRow[]): boolean {
  if (signoffs.length === 0) return false;
  return signoffs.every((s) => s.decision != null);
}

/** True when at least one signoff is still pending (decision === null). */
export function hasPendingSignoff(signoffs: readonly SignoffRow[]): boolean {
  return signoffs.some((s) => s.decision == null);
}

/** UI helpers for decision chips. */
export function decisionLabel(d: ReviewDecision): string {
  switch (d) {
    case "approved":
      return "Approved";
    case "approved_with_comments":
      return "Approved w/ comments";
    case "rejected":
      return "Rejected";
    case "waived":
      return "Waived";
    default:
      return "Pending";
  }
}

/** Return true when an open round with the given due date is overdue vs `today`. */
export function isOverdue(
  dueDate: string | null | undefined,
  status: "open" | "closed" | "waived",
  today: Date = new Date(),
): boolean {
  if (status !== "open" || !dueDate) return false;
  const due = new Date(dueDate + "T00:00:00Z");
  const t = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  return due.getTime() < t.getTime();
}
