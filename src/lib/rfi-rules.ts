// P-059 — Pure helpers for the RFI module (testable, no I/O).

export type RfiStatus = "open" | "in_review" | "answered" | "closed" | "void";

export interface RfiLite {
  status: RfiStatus;
  due_date: string | null;
  created_at: string;
  answered_at: string | null;
  raised_by: string | null;
  routed_to: string | null;
}

/** Compute the next `RFI-####` given the list of existing numbers. */
export function nextRfiNumber(existing: string[]): string {
  const nums = existing
    .map((n) => /^RFI-(\d{4,})$/i.exec(n ?? "")?.[1])
    .filter((x): x is string => Boolean(x))
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
  return `RFI-${String(next).padStart(4, "0")}`;
}

export function isOverdue(
  rfi: {
    status: RfiStatus;
    due_date: string | null;
  },
  today: Date = new Date(),
): boolean {
  if (!rfi.due_date) return false;
  if (rfi.status !== "open" && rfi.status !== "in_review") return false;
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  return new Date(rfi.due_date) < t;
}

export function canAnswer(params: {
  userId: string;
  isAdmin: boolean;
  routed_to: string | null;
  status: RfiStatus;
}): boolean {
  if (params.status !== "open" && params.status !== "in_review") return false;
  return params.isAdmin || params.routed_to === params.userId;
}

export function canClose(params: {
  userId: string;
  isAdmin: boolean;
  raised_by: string | null;
  status: RfiStatus;
}): boolean {
  if (params.status !== "answered") return false;
  return params.isAdmin || params.raised_by === params.userId;
}

/** Whole-day difference (days), rounded to integer. */
function diffDays(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

export interface RfiKpis {
  turnaround_days_avg: number | null;
  open_count: number;
  overdue_count: number;
  pct_on_time: number | null;
  answered_count: number;
  total_count: number;
}

export function computeKpis(rows: RfiLite[], today: Date = new Date()): RfiKpis {
  const total = rows.length;
  let open = 0;
  let overdue = 0;
  const turnaroundDays: number[] = [];
  let onTime = 0;
  let answered = 0;
  for (const r of rows) {
    if (r.status === "open" || r.status === "in_review") open += 1;
    if (isOverdue(r, today)) overdue += 1;
    if (r.answered_at) {
      answered += 1;
      turnaroundDays.push(diffDays(new Date(r.answered_at), new Date(r.created_at)));
      if (r.due_date) {
        const dueMs = new Date(r.due_date).getTime();
        const ansDay = new Date(r.answered_at);
        ansDay.setHours(0, 0, 0, 0);
        if (ansDay.getTime() <= dueMs) onTime += 1;
      }
    }
  }
  const avg =
    turnaroundDays.length === 0
      ? null
      : Math.round((turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length) * 10) / 10;
  const pct = answered === 0 ? null : Math.round((onTime / answered) * 100);
  return {
    turnaround_days_avg: avg,
    open_count: open,
    overdue_count: overdue,
    pct_on_time: pct,
    answered_count: answered,
    total_count: total,
  };
}

export const RFI_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RfiPriority = (typeof RFI_PRIORITIES)[number];

export const RFI_STATUSES: RfiStatus[] = ["open", "in_review", "answered", "closed", "void"];
