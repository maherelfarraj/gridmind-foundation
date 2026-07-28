// P-267 — Retention classes made actionable.
//
// The five classes from P-263 carry a window; nothing is ever auto-deleted —
// documents become *disposal-eligible* and enter an audited review queue.
export const RETENTION_CLASSES = [
  "permanent",
  "contract_term",
  "seven_years",
  "three_years",
  "transient",
] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface RetentionClassMeta {
  key: RetentionClass;
  /** Window in days; null = never expires or is anchored to the contract. */
  days: number | null;
  anchored: boolean;
}

export const RETENTION_CLASS_META: Record<RetentionClass, RetentionClassMeta> = {
  permanent: { key: "permanent", days: null, anchored: false },
  contract_term: { key: "contract_term", days: null, anchored: true },
  seven_years: { key: "seven_years", days: 365 * 7, anchored: false },
  three_years: { key: "three_years", days: 365 * 3, anchored: false },
  transient: { key: "transient", days: 90, anchored: false },
};

export function isRetentionClass(v: unknown): v is RetentionClass {
  return typeof v === "string" && (RETENTION_CLASSES as readonly string[]).includes(v);
}

export interface RetentionSummaryRow {
  retention_class: string;
  total: number | string;
  active?: number | string;
  superseded?: number | string;
  obsolete?: number | string;
  expiring_90d?: number | string;
  disposal_eligible?: number | string;
  on_hold?: number | string;
}

export interface ClassDistributionRow {
  retentionClass: RetentionClass;
  total: number;
  active: number;
  superseded: number;
  obsolete: number;
  expiring90d: number;
  disposalEligible: number;
  onHold: number;
  share: number;
}

const n = (v: unknown): number => {
  const parsed = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Class distribution across every class — classes with no documents are still
 * reported (share 0) so the report never silently hides a class.
 */
export function classDistribution(rows: RetentionSummaryRow[]): ClassDistributionRow[] {
  const byClass = new Map<string, RetentionSummaryRow>();
  for (const r of rows ?? []) byClass.set(r.retention_class, r);

  const grand = RETENTION_CLASSES.reduce((sum, key) => sum + n(byClass.get(key)?.total), 0);

  return RETENTION_CLASSES.map((key) => {
    const r = byClass.get(key);
    const total = n(r?.total);
    return {
      retentionClass: key,
      total,
      active: n(r?.active),
      superseded: n(r?.superseded),
      obsolete: n(r?.obsolete),
      expiring90d: n(r?.expiring_90d),
      disposalEligible: n(r?.disposal_eligible),
      onHold: n(r?.on_hold),
      share: grand === 0 ? 0 : total / grand,
    };
  });
}

export function distributionTotals(rows: ClassDistributionRow[]) {
  return rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      expiring90d: acc.expiring90d + r.expiring90d,
      disposalEligible: acc.disposalEligible + r.disposalEligible,
      onHold: acc.onHold + r.onHold,
    }),
    { total: 0, expiring90d: 0, disposalEligible: 0, onHold: 0 },
  );
}

export interface DisposalQueueRow {
  id: string;
  doc_number: string | null;
  title: string;
  doc_type: string;
  status: string;
  retention_class: string;
  retention_expires_at: string | null;
  legal_hold: boolean;
  eligible?: boolean;
  project_id: string | null;
  project_name: string | null;
}

/** Eligible = window passed, no legal hold. Permanent docs never qualify. */
export function isDisposalEligible(row: DisposalQueueRow, now: Date = new Date()): boolean {
  if (row.legal_hold) return false;
  if (row.retention_class === "permanent") return false;
  if (!row.retention_expires_at) return false;
  return new Date(row.retention_expires_at).getTime() <= now.getTime();
}

/** Days until the window closes; negative once past. */
export function daysToExpiry(row: DisposalQueueRow, now: Date = new Date()): number | null {
  if (!row.retention_expires_at) return null;
  const ms = new Date(row.retention_expires_at).getTime() - now.getTime();
  return Math.floor(ms / 86_400_000);
}

export function partitionQueue(rows: DisposalQueueRow[], now: Date = new Date()) {
  const eligible: DisposalQueueRow[] = [];
  const maturing: DisposalQueueRow[] = [];
  const held: DisposalQueueRow[] = [];
  for (const row of rows ?? []) {
    if (row.legal_hold) held.push(row);
    else if (isDisposalEligible(row, now)) eligible.push(row);
    else maturing.push(row);
  }
  return { eligible, maturing, held };
}
