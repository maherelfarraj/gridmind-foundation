// Day 2 — PO approvals on the P-111 engine. Pure, offline-testable rules.
import type { PoStatus } from "@/lib/po-rules";

export const PO_APPROVAL_RULE_KEY = "po_threshold_finance";
export const PO_APPROVAL_ENTITY = "purchase_order";
export const PO_APPROVAL_DEFAULT_THRESHOLD = 50_000;

export type InstanceStatus = "pending" | "in_progress" | "approved" | "rejected" | "cancelled";

/** The dollar gate stays in the submit path; the engine owns the decision. */
export function poRequiresApproval(total: number, threshold: number | null | undefined): boolean {
  return Number(total ?? 0) > Number(threshold ?? 0);
}

/**
 * Engine-driven PO status. Returns null when the instance state implies no
 * change (cancelled instances leave the PO where it is).
 */
export function poStatusForInstance(status: InstanceStatus): PoStatus | null {
  switch (status) {
    case "pending":
    case "in_progress":
      return "pending_approval";
    case "approved":
      return "approved";
    case "rejected":
      return "draft";
    default:
      return null;
  }
}

/** A PO may only be issued once it is engine-approved (or auto-approved below threshold). */
export function canIssuePo(status: PoStatus): boolean {
  return status === "approved";
}

/** Idempotency: an open instance already exists → never open a second one. */
export function shouldOpenInstance(existing: { status: InstanceStatus } | null): boolean {
  if (!existing) return true;
  return existing.status !== "pending" && existing.status !== "in_progress";
}

/** Escalation sweep predicate — mirrors escalate_overdue_approvals(). */
export function isInstanceOverdue(
  instance: { status: InstanceStatus; sla_due_at: string | null; escalated_at?: string | null },
  now: Date = new Date(),
): boolean {
  if (instance.status !== "pending" && instance.status !== "in_progress") return false;
  if (!instance.sla_due_at) return false;
  if (instance.escalated_at) return false;
  return new Date(instance.sla_due_at).getTime() < now.getTime();
}
