// P-091 — Submittal pure helpers and zod schemas.
import { z } from "zod";

export const SUBMITTAL_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "approved_as_noted",
  "revise_resubmit",
  "rejected",
] as const;
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

export const SUBMITTAL_STATUS_LABELS: Record<SubmittalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  approved_as_noted: "Approved as noted",
  revise_resubmit: "Revise & resubmit",
  rejected: "Rejected",
};

export const REVIEW_DECISIONS = [
  "approved",
  "approved_as_noted",
  "revise_resubmit",
  "rejected",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const submittalCreateInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(2).max(300),
  specSection: z.string().trim().max(120).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  filePath: z.string().trim().max(500).nullable().optional(),
});
export type SubmittalCreateInput = z.infer<typeof submittalCreateInput>;

export const submittalReviewInput = z.object({
  id: z.string().uuid(),
  status: z.enum(REVIEW_DECISIONS),
  reviewNotes: z.string().trim().max(4000).nullable().optional(),
});
export type SubmittalReviewInput = z.infer<typeof submittalReviewInput>;

export const submittalReviseInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(300).optional(),
  specSection: z.string().trim().max(120).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  filePath: z.string().trim().max(500).nullable().optional(),
});
export type SubmittalReviseInput = z.infer<typeof submittalReviseInput>;

const WRITE_ROLES = new Set([
  "construction_admin",
  "engineering_admin",
  "company_admin",
]);
export function canWriteSubmittal(roles: readonly string[]): boolean {
  return roles.some((r) => WRITE_ROLES.has(r));
}

export function nextSubmittalNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^SUB-(\d+)$/i.exec(n ?? "");
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `SUB-${(max + 1).toString().padStart(4, "0")}`;
}

export function nextRevisionLabel(existing: string[]): string {
  let max = -1;
  for (const r of existing) {
    const m = /^R(\d+)$/i.exec(r ?? "");
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `R${max + 1}`;
}

export function submittalStatusTint(status: SubmittalStatus): string {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground border-border";
    case "submitted":
    case "under_review":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "approved":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "approved_as_noted":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
    case "revise_resubmit":
      return "bg-amber-500/25 text-amber-800 dark:text-amber-200 border-amber-500/40";
    case "rejected":
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

export function avgTurnaroundDays(
  rows: Array<{ submitted_at: string | null; reviewed_at: string | null }>,
): number | null {
  const paired = rows.filter((r) => r.submitted_at && r.reviewed_at);
  if (paired.length === 0) return null;
  const total = paired.reduce((acc, r) => {
    const a = new Date(r.submitted_at!).getTime();
    const b = new Date(r.reviewed_at!).getTime();
    return acc + Math.max(0, b - a);
  }, 0);
  return total / paired.length / 86_400_000;
}
