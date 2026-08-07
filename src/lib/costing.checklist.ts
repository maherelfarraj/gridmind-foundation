// GC-07 — Period Close Cockpit: pure rules, schemas and deterministic exports.
//
// Everything here is side-effect free so the same rules run in the UI, on the
// server and in tests. The DATABASE remains authoritative for the hard-close
// gate (`costing_close_blockers`); `closeGate()` below mirrors it so the UI can
// explain *why* the button is disabled without ever being trusted.
import { z } from "zod";

import { toCsv } from "@/lib/csv";
import type { ReadinessItem } from "@/lib/costing.periods";

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------
export const CHECKLIST_STATUSES = [
  "pending",
  "in_progress",
  "ready_for_review",
  "completed",
  "waived",
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_STATUSES)[number];

export const EXCEPTION_STATUSES = ["open", "in_progress", "resolved", "accepted_risk"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export type ExceptionSeverity = "blocker" | "warning";

/** Flat, RPC-serialisable detail payload for exceptions and audit metadata. */
export type CloseDetail = Record<
  string,
  string | number | boolean | null | string[] | number[] | undefined
>;

export interface ChecklistItem {
  id: string;
  seq: number;
  category: string;
  title: string;
  instructions: string | null;
  is_required: boolean;
  requires_evidence: boolean;
  owner_role: string | null;
  due_date: string | null;
  status: ChecklistItemStatus;
  assignee_id: string | null;
  reviewer_id: string | null;
  notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waiver_reason: string | null;
  ready_at: string | null;
  row_version: number;
  evidence_count: number;
}

export interface CloseException {
  id: string;
  period_month: string;
  source: string;
  exception_type: string;
  severity: ExceptionSeverity;
  entity_table: string | null;
  entity_id: string | null;
  fingerprint: string;
  title: string;
  detail: CloseDetail;
  status: ExceptionStatus;
  owner_id: string | null;
  due_date: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reopen_count: number;
  first_seen_at: string;
  last_seen_at: string;
  row_version: number;
}

export interface ClosePolicy {
  allow_self_review: boolean;
  block_on_warnings: boolean;
}

export const CLOSE_POLICY_DEFAULTS: ClosePolicy = {
  allow_self_review: false,
  block_on_warnings: false,
};

/** An item is finished when it is completed or formally waived. */
export function isDone(item: Pick<ChecklistItem, "status">): boolean {
  return item.status === "completed" || item.status === "waived";
}

export function isOverdue(
  item: Pick<ChecklistItem, "status" | "due_date">,
  today: string,
): boolean {
  if (isDone(item) || !item.due_date) return false;
  return item.due_date < today;
}

export interface ChecklistProgress {
  total: number;
  required: number;
  completed: number;
  waived: number;
  done: number;
  outstanding: number;
  requiredOutstanding: number;
  overdue: number;
  readyForReview: number;
  /** 0-100, rounded to one decimal. Null when the checklist is empty. */
  pct: number | null;
}

export function checklistProgress(
  items: readonly ChecklistItem[],
  today: string,
): ChecklistProgress {
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const waived = items.filter((i) => i.status === "waived").length;
  const done = completed + waived;
  const required = items.filter((i) => i.is_required).length;
  return {
    total,
    required,
    completed,
    waived,
    done,
    outstanding: total - done,
    requiredOutstanding: items.filter((i) => i.is_required && !isDone(i)).length,
    overdue: items.filter((i) => isOverdue(i, today)).length,
    readyForReview: items.filter((i) => i.status === "ready_for_review").length,
    pct: total === 0 ? null : Math.round((done / total) * 1000) / 10,
  };
}

/** Outstanding required work, soonest due first; undated items sort last. */
export function criticalPath(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items
    .filter((i) => i.is_required && !isDone(i))
    .slice()
    .sort((a, b) => {
      const ad = a.due_date ?? "9999-12-31";
      const bd = b.due_date ?? "9999-12-31";
      return ad === bd ? a.seq - b.seq : ad < bd ? -1 : 1;
    });
}

export function groupByCategory(
  items: readonly ChecklistItem[],
): { category: string; items: ChecklistItem[] }[] {
  const map = new Map<string, ChecklistItem[]>();
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    const bucket = map.get(item.category);
    if (bucket) bucket.push(item);
    else map.set(item.category, [item]);
  }
  return [...map.entries()]
    .map(([category, group]) => ({ category, items: group }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

export interface ChecklistFilter {
  status: ChecklistItemStatus | "all" | "outstanding";
  ownerId: string | "all";
  category: string | "all";
}

export function filterChecklist(
  items: readonly ChecklistItem[],
  filter: ChecklistFilter,
): ChecklistItem[] {
  return items.filter((i) => {
    if (filter.status === "outstanding" ? isDone(i) : filter.status !== "all" && i.status !== filter.status) {
      return false;
    }
    if (filter.ownerId !== "all" && i.assignee_id !== filter.ownerId) return false;
    if (filter.category !== "all" && i.category !== filter.category) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Status transitions (mirrors update_costing_checklist_item)
// ---------------------------------------------------------------------------
const ALLOWED_NEXT: Record<ChecklistItemStatus, readonly ChecklistItemStatus[]> = {
  pending: ["in_progress", "ready_for_review", "waived"],
  in_progress: ["pending", "ready_for_review", "waived"],
  ready_for_review: ["in_progress", "completed", "waived"],
  completed: ["in_progress"],
  waived: ["pending", "in_progress"],
};

export function canTransitionItem(
  from: ChecklistItemStatus,
  to: ChecklistItemStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_NEXT[from].includes(to);
}

export interface SodContext {
  actorId: string;
  preparedBy: string | null;
  requiresEvidence: boolean;
  allowSelfReview: boolean;
}

/**
 * Segregation of duties: the person who marked an evidence-bearing item ready
 * for review may not also complete (review) it, unless company policy allows
 * self-review.
 */
export function violatesSegregationOfDuties(ctx: SodContext): boolean {
  if (!ctx.requiresEvidence || ctx.allowSelfReview) return false;
  return Boolean(ctx.preparedBy) && ctx.preparedBy === ctx.actorId;
}

// ---------------------------------------------------------------------------
// Readiness -> durable exceptions
// ---------------------------------------------------------------------------
export const READINESS_SOURCE = "readiness";

/**
 * Stable per-period identity for a readiness finding. It deliberately excludes
 * the count so a recurring finding updates one row instead of spawning a new
 * one every refresh.
 */
export function readinessFingerprint(item: Pick<ReadinessItem, "key">): string {
  return `${READINESS_SOURCE}:${item.key}`;
}

export interface ExceptionSeed {
  source: string;
  exception_type: string;
  severity: ExceptionSeverity;
  fingerprint: string;
  title: string;
  detail: CloseDetail;
}

/** Project readiness findings into deduplicated exception seeds. */
export function exceptionSeeds(items: readonly ReadinessItem[]): ExceptionSeed[] {
  return items.map((i) => ({
    source: READINESS_SOURCE,
    exception_type: i.key,
    severity: i.severity,
    fingerprint: readinessFingerprint(i),
    title: i.key,
    detail: {
      count: i.count,
      ...(i.currencies && i.currencies.length > 0 ? { currencies: i.currencies } : {}),
    },
  }));
}

export function isExceptionOpen(e: Pick<CloseException, "status">): boolean {
  return e.status === "open" || e.status === "in_progress";
}

/** Seeds no longer produced by readiness — auto-resolvable stale exceptions. */
export function staleExceptionIds(
  existing: readonly CloseException[],
  seeds: readonly ExceptionSeed[],
): string[] {
  const live = new Set(seeds.map((s) => `${s.source}:${s.fingerprint}`));
  return existing
    .filter((e) => e.source === READINESS_SOURCE && isExceptionOpen(e))
    .filter((e) => !live.has(`${e.source}:${e.fingerprint}`))
    .map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Hard-close gate (UI mirror of costing_close_blockers)
// ---------------------------------------------------------------------------
export interface CloseBlocker {
  key:
    | "incomplete_required_items"
    | "missing_evidence"
    | "unresolved_blocker_exceptions"
    | "unresolved_warning_exceptions"
    | "unexplained_material_movement";
  count: number;
}

export interface CloseGateInput {
  items: readonly ChecklistItem[];
  exceptions: readonly CloseException[];
  policy: ClosePolicy;
  /** Material forecast movements still lacking a written explanation. */
  unexplainedMaterialMovements?: number;
}

export function closeGate(input: CloseGateInput): { blockers: CloseBlocker[]; ready: boolean } {
  const blockers: CloseBlocker[] = [];

  const incomplete = input.items.filter((i) => i.is_required && !isDone(i)).length;
  if (incomplete > 0) blockers.push({ key: "incomplete_required_items", count: incomplete });

  const missingEvidence = input.items.filter(
    (i) => i.requires_evidence && i.status === "completed" && i.evidence_count === 0,
  ).length;
  if (missingEvidence > 0) blockers.push({ key: "missing_evidence", count: missingEvidence });

  const openBlockers = input.exceptions.filter(
    (e) => e.severity === "blocker" && isExceptionOpen(e),
  ).length;
  if (openBlockers > 0) {
    blockers.push({ key: "unresolved_blocker_exceptions", count: openBlockers });
  }

  if (input.policy.block_on_warnings) {
    const openWarnings = input.exceptions.filter(
      (e) => e.severity === "warning" && isExceptionOpen(e),
    ).length;
    if (openWarnings > 0) {
      blockers.push({ key: "unresolved_warning_exceptions", count: openWarnings });
    }
  }

  const unexplained = input.unexplainedMaterialMovements ?? 0;
  if (unexplained > 0) {
    blockers.push({ key: "unexplained_material_movement", count: unexplained });
  }

  return { blockers, ready: blockers.length === 0 };
}

// ---------------------------------------------------------------------------
// Deterministic CSV exports
// ---------------------------------------------------------------------------
const CHECKLIST_CSV_HEADERS = [
  "seq",
  "category",
  "title",
  "required",
  "requires_evidence",
  "owner_role",
  "due_date",
  "status",
  "assignee",
  "reviewer",
  "completed_at",
  "reviewed_at",
  "waived_at",
  "waiver_reason",
  "evidence_count",
  "notes",
];

export interface PeopleLookup {
  (userId: string | null | undefined): string;
}

const noName: PeopleLookup = (id) => id ?? "";

export function buildChecklistCsv(
  items: readonly ChecklistItem[],
  nameOf: PeopleLookup = noName,
): string {
  const rows = [...items]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => [
      i.seq,
      i.category,
      i.title,
      i.is_required ? "yes" : "no",
      i.requires_evidence ? "yes" : "no",
      i.owner_role ?? "",
      i.due_date ?? "",
      i.status,
      nameOf(i.assignee_id),
      nameOf(i.reviewer_id),
      i.completed_at ?? "",
      i.reviewed_at ?? "",
      i.waived_at ?? "",
      i.waiver_reason ?? "",
      i.evidence_count,
      i.notes ?? "",
    ]);
  return toCsv(CHECKLIST_CSV_HEADERS, rows);
}

const EXCEPTION_CSV_HEADERS = [
  "source",
  "type",
  "severity",
  "status",
  "title",
  "entity_table",
  "entity_id",
  "owner",
  "due_date",
  "reopen_count",
  "first_seen_at",
  "last_seen_at",
  "resolution_note",
  "resolved_at",
  "approved_at",
];

export function buildExceptionsCsv(
  rows: readonly CloseException[],
  nameOf: PeopleLookup = noName,
): string {
  const sorted = [...rows].sort((a, b) =>
    a.severity === b.severity
      ? a.fingerprint < b.fingerprint
        ? -1
        : a.fingerprint > b.fingerprint
          ? 1
          : 0
      : a.severity === "blocker"
        ? -1
        : 1,
  );
  return toCsv(
    EXCEPTION_CSV_HEADERS,
    sorted.map((e) => [
      e.source,
      e.exception_type,
      e.severity,
      e.status,
      e.title,
      e.entity_table ?? "",
      e.entity_id ?? "",
      nameOf(e.owner_id),
      e.due_date ?? "",
      e.reopen_count,
      e.first_seen_at,
      e.last_seen_at,
      e.resolution_note ?? "",
      e.resolved_at ?? "",
      e.approved_at ?? "",
    ]),
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const monthStart = z.string().regex(/^\d{4}-\d{2}-01$/, "Period must be YYYY-MM-01");

export const closeCockpitQuerySchema = z.object({
  projectId: uuid,
  period: monthStart.optional(),
});

export const checklistItemUpdateSchema = z
  .object({
    itemId: uuid,
    expectedVersion: z.number().int().positive(),
    status: z.enum(CHECKLIST_STATUSES).optional(),
    assigneeId: uuid.nullable().optional(),
    reviewerId: uuid.nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    waiverReason: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "waived" && !String(v.waiverReason ?? "").trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["waiverReason"],
        message: "A waiver reason is required.",
      });
    }
  });

export const exceptionResolveSchema = z
  .object({
    exceptionId: uuid,
    expectedVersion: z.number().int().positive(),
    status: z.enum(EXCEPTION_STATUSES),
    note: z.string().trim().max(4000).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.status === "resolved" || v.status === "accepted_risk") &&
      !String(v.note ?? "").trim()
    ) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "A resolution note is required." });
    }
  });

export const evidenceLinkSchema = z.object({
  itemId: uuid,
  documentId: uuid,
  label: z.string().trim().max(200).nullable().optional(),
});

export const evidenceUnlinkSchema = z.object({ evidenceId: uuid });

export const closePackSchema = z.object({ projectId: uuid, period: monthStart });

export type ChecklistItemUpdateInput = z.infer<typeof checklistItemUpdateSchema>;
export type ExceptionResolveInput = z.infer<typeof exceptionResolveSchema>;
export type EvidenceLinkInput = z.infer<typeof evidenceLinkSchema>;
