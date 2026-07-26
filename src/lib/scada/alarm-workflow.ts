/**
 * P-174 — Pure alarm-console workflow helpers.
 * No React / Supabase imports: safe for unit tests and both runtimes.
 */
import { z } from "zod";

export const RCA_STATUSES = ["open", "triaged", "root_cause_identified", "closed"] as const;
export type RcaStatus = (typeof RCA_STATUSES)[number];

export const RCA_STATUS_LABELS: Record<RcaStatus, string> = {
  open: "Open",
  triaged: "Triaged",
  root_cause_identified: "Root cause identified",
  closed: "Closed",
};

/** Forward-only workflow. Each state may also stay put (notes-only edits). */
const ALLOWED_NEXT: Record<RcaStatus, RcaStatus[]> = {
  open: ["open", "triaged"],
  triaged: ["triaged", "root_cause_identified"],
  root_cause_identified: ["root_cause_identified", "closed"],
  closed: ["closed"],
};

export interface RcaTransitionInput {
  from: RcaStatus;
  to: RcaStatus;
  rootCause?: string | null;
  /** P-105 alarm status — closing requires an acknowledged alarm. */
  alarmStatus: string;
}

export type RcaTransitionResult = { ok: true } | { ok: false; code: string; message: string };

export function validateRcaTransition(input: RcaTransitionInput): RcaTransitionResult {
  const { from, to, rootCause, alarmStatus } = input;
  if (!ALLOWED_NEXT[from].includes(to)) {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Cannot move root-cause status from ${RCA_STATUS_LABELS[from]} to ${RCA_STATUS_LABELS[to]}.`,
    };
  }
  if (
    (to === "root_cause_identified" || to === "closed") &&
    (!rootCause || rootCause.trim().length === 0)
  ) {
    return {
      ok: false,
      code: "root_cause_required",
      message: "A root cause is required to reach “Root cause identified”.",
    };
  }
  if (to === "closed" && alarmStatus === "active") {
    return {
      ok: false,
      code: "acknowledge_required",
      message: "Acknowledge the alarm before closing the root-cause investigation.",
    };
  }
  return { ok: true };
}

export const assignAlarmSchema = z.object({
  id: z.string().uuid(),
  assigned_to: z.string().uuid().nullable(),
});
export type AssignAlarmInput = z.infer<typeof assignAlarmSchema>;

export const rcaUpdateSchema = z.object({
  id: z.string().uuid(),
  rca_status: z.enum(RCA_STATUSES),
  root_cause: z.string().trim().max(2000).nullable().optional(),
  rca_notes: z.string().trim().max(4000).nullable().optional(),
});
export type RcaUpdateInput = z.infer<typeof rcaUpdateSchema>;

export interface AlarmTimingRow {
  raised_at: string;
  acknowledged_at: string | null;
}

/** Mean time to acknowledge, in minutes. Null when nothing acknowledged yet. */
export function meanTimeToAcknowledgeMinutes(rows: AlarmTimingRow[]): number | null {
  const deltas: number[] = [];
  for (const r of rows) {
    if (!r.acknowledged_at) continue;
    const raised = Date.parse(r.raised_at);
    const acked = Date.parse(r.acknowledged_at);
    if (Number.isNaN(raised) || Number.isNaN(acked) || acked < raised) continue;
    deltas.push((acked - raised) / 60_000);
  }
  if (deltas.length === 0) return null;
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Number(mean.toFixed(1));
}

export interface SeverityCount {
  severity: string;
  count: number;
}

export function countBySeverity(rows: { severity: string }[], order: readonly string[]) {
  const counts = new Map<string, number>();
  for (const s of order) counts.set(s, 0);
  for (const r of rows) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1);
  return Array.from(counts, ([severity, count]) => ({ severity, count })) as SeverityCount[];
}

export function countUnacknowledgedCritical(rows: { severity: string; status: string }[]): number {
  return rows.filter((r) => r.severity === "critical" && r.status === "active").length;
}
