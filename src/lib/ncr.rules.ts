// P-091 — NCR pure helpers and zod schemas.
import { z } from "zod";

export const NCR_SOURCES = [
  "inspection",
  "punch_item",
  "observation",
  "other",
] as const;
export type NcrSource = (typeof NCR_SOURCES)[number];
export const NCR_SOURCE_LABELS: Record<NcrSource, string> = {
  inspection: "Inspection",
  punch_item: "Punch item",
  observation: "Field observation",
  other: "Other",
};

export const NCR_DISPOSITIONS = [
  "pending",
  "rework",
  "repair",
  "use_as_is",
  "scrap",
] as const;
export type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];
export const NCR_DISPOSITION_LABELS: Record<NcrDisposition, string> = {
  pending: "Pending",
  rework: "Rework",
  repair: "Repair",
  use_as_is: "Use as-is",
  scrap: "Scrap",
};

export const NCR_STATUSES = ["open", "in_progress", "closed", "void"] as const;
export type NcrStatus = (typeof NCR_STATUSES)[number];
export const NCR_STATUS_LABELS: Record<NcrStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
  void: "Void",
};

export const ncrCreateInput = z.object({
  projectId: z.string().uuid(),
  source: z.enum(NCR_SOURCES).default("other"),
  sourceId: z.string().uuid().nullable().optional(),
  discipline: z.string().trim().max(80).nullable().optional(),
  area: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().min(4).max(4000),
  costImpact: z.number().finite().nullable().optional(),
  currencyCode: z.string().trim().length(3).nullable().optional(),
});
export type NcrCreateInput = z.infer<typeof ncrCreateInput>;

export const ncrDispositionInput = z
  .object({
    id: z.string().uuid(),
    disposition: z.enum(NCR_DISPOSITIONS),
    rootCause: z.string().trim().max(4000).nullable().optional(),
    correctiveAction: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(NCR_STATUSES).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.disposition === "use_as_is") {
      if (!v.rootCause || !v.rootCause.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rootCause"],
          message: "Root cause is required for use-as-is disposition.",
        });
      }
      if (!v.correctiveAction || !v.correctiveAction.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correctiveAction"],
          message: "Corrective action is required for use-as-is disposition.",
        });
      }
    }
  });
export type NcrDispositionInput = z.infer<typeof ncrDispositionInput>;

export const ncrCloseInput = z.object({ id: z.string().uuid() });
export const ncrVoidInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(2).max(500),
});

const WRITE_ROLES = new Set([
  "construction_admin",
  "foreman",
  "field_technician",
  "company_admin",
]);
export function canWriteNcr(roles: readonly string[]): boolean {
  return roles.some((r) => WRITE_ROLES.has(r));
}

export function nextNcrNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^NCR-(\d+)$/i.exec(n ?? "");
    if (!m) continue;
    const v = parseInt(m[1], 10);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `NCR-${(max + 1).toString().padStart(4, "0")}`;
}

export function daysOpen(row: {
  status: NcrStatus;
  created_at: string;
  closed_at: string | null;
}): number {
  const start = new Date(row.created_at).getTime();
  const end =
    row.status === "closed" && row.closed_at
      ? new Date(row.closed_at).getTime()
      : Date.now();
  const diff = end - start;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export function ncrStatusTint(status: NcrStatus): string {
  switch (status) {
    case "open":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "in_progress":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "closed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "void":
      return "bg-muted text-muted-foreground border-border line-through";
  }
}

export function ncrDispositionTint(d: NcrDisposition): string {
  switch (d) {
    case "pending":
      return "bg-muted text-muted-foreground border-border";
    case "rework":
    case "repair":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "use_as_is":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "scrap":
      return "bg-destructive/25 text-destructive border-destructive/40";
  }
}
