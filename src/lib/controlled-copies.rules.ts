// P-266 — Controlled-copy discipline: pure rules (no I/O, no React).
//
// Copy numbering, recall-completeness math, overdue detection and the
// watermark/stamp caption builders all live here so they can be unit-tested
// and reused by both the UI and the PDF generators.

export type CopyStatus = "issued" | "returned" | "recalled" | "destroyed";
export type Disposition = "recalled" | "returned" | "destroyed";

/** Grace period between a copy becoming recall-due and being flagged overdue. */
export const RECALL_GRACE_DAYS = 14;

export const UNCONTROLLED_EN = "UNCONTROLLED WHEN PRINTED";
export const UNCONTROLLED_AR = "غير خاضع للتحكم عند الطباعة";
export const CONTROLLED_EN = "CONTROLLED COPY";
export const CONTROLLED_AR = "نسخة خاضعة للتحكم";

export interface CopyLike {
  copy_number: number;
  status: CopyStatus | string;
  recall_due_at?: string | null;
  holder_name?: string | null;
  revision_pinned?: string | null;
}

/** The next copy number for a document: strictly sequential, gaps preserved. */
export function nextCopyNumber(existing: Array<{ copy_number: number }>): number {
  return existing.reduce((max, c) => Math.max(max, c.copy_number ?? 0), 0) + 1;
}

export function isOutstanding(copy: CopyLike): boolean {
  return copy.status === "issued";
}

export function isRecallDue(copy: CopyLike): boolean {
  return isOutstanding(copy) && Boolean(copy.recall_due_at);
}

/** Overdue = recall-due for longer than the grace period and still outstanding. */
export function isRecallOverdue(copy: CopyLike, now: Date = new Date()): boolean {
  if (!isRecallDue(copy)) return false;
  const due = new Date(copy.recall_due_at as string).getTime();
  if (Number.isNaN(due)) return false;
  return now.getTime() - due > RECALL_GRACE_DAYS * 86_400_000;
}

export interface Completeness {
  total: number;
  outstanding: number;
  closed: number;
  recallDue: number;
  /** 0–1; 1 when nothing is outstanding against an old revision. */
  ratio: number;
  complete: boolean;
}

/**
 * Recall completeness for a document: "3 of 4 copies recalled" counts every
 * copy ever issued, closed = recalled | returned | destroyed.
 */
export function recallCompleteness(copies: CopyLike[]): Completeness {
  const total = copies.length;
  const outstanding = copies.filter(isOutstanding).length;
  const closed = total - outstanding;
  const recallDue = copies.filter(isRecallDue).length;
  return {
    total,
    outstanding,
    closed,
    recallDue,
    ratio: total === 0 ? 1 : closed / total,
    complete: recallDue === 0,
  };
}

export function holderLabel(copy: {
  holder_name?: string | null;
  holder_user_id?: string | null;
  holder_contact_id?: string | null;
}): string {
  const name = (copy.holder_name ?? "").trim();
  if (name) return name;
  if (copy.holder_user_id) return "Internal holder";
  if (copy.holder_contact_id) return "External contact";
  return "Unassigned";
}

/** Per-holder rollup for the recall dashboard. */
export function summariseByHolder<T extends CopyLike & { holder_name?: string | null }>(
  copies: T[],
  now: Date = new Date(),
): Array<{ holder: string; outstanding: number; due: number; overdue: number }> {
  const map = new Map<
    string,
    { holder: string; outstanding: number; due: number; overdue: number }
  >();
  for (const c of copies) {
    const holder = holderLabel(c);
    const row = map.get(holder) ?? { holder, outstanding: 0, due: 0, overdue: 0 };
    if (isOutstanding(c)) row.outstanding += 1;
    if (isRecallDue(c)) row.due += 1;
    if (isRecallOverdue(c, now)) row.overdue += 1;
    map.set(holder, row);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due);
}

export interface StampMeta {
  docNumber: string | null;
  revision: string;
  printedAt: Date;
  copyNumber?: number;
  holder?: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "CONTROLLED COPY No 3 - Site Office - 2026-07-28" */
export function controlledStampCaption(meta: StampMeta): string {
  const parts = [
    `${CONTROLLED_EN} No ${meta.copyNumber ?? "-"}`,
    meta.holder ?? "Unassigned",
    iso(meta.printedAt),
  ];
  return parts.join(" - ");
}

/** "UNCONTROLLED WHEN PRINTED - DOC-0007 Rev B - 2026-07-28" */
export function uncontrolledCaption(meta: StampMeta): string {
  return `${UNCONTROLLED_EN} - ${meta.docNumber ?? "UNREGISTERED"} Rev ${meta.revision} - ${iso(
    meta.printedAt,
  )}`;
}

/**
 * Typed 409 raised by `issue_controlled_copy` when the target revision is no
 * longer current. `detail` carries the current document id, if any.
 */
export interface DocNotCurrentError {
  code: "doc_not_current";
  currentDocumentId: string | null;
}

export function parseDocNotCurrent(error: unknown): DocNotCurrentError | null {
  const e = error as { message?: string; details?: string; detail?: string } | null;
  if (!e || typeof e.message !== "string" || !e.message.includes("doc_not_current")) return null;
  const raw = (e.details ?? e.detail ?? "").trim();
  return { code: "doc_not_current", currentDocumentId: raw.length > 0 ? raw : null };
}
