// P-076 — EVM (earned value management) pure rules.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface EvmTaskInput {
  id: string;
  start_date: string; // ISO date
  end_date: string; // ISO date
  progress_pct: number; // 0–100
  budgeted_amount: number | null; // from WBS
}

export interface EvmComputation {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  taskCount: number;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function toDateOnly(iso: string): Date {
  // Treat as UTC midnight to avoid TZ drift.
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function plannedPercentAtDate(start: string, end: string, snapshot: string): number {
  const s = toDateOnly(start).getTime();
  const e = toDateOnly(end).getTime();
  const t = toDateOnly(snapshot).getTime();
  if (t <= s) return 0;
  if (t >= e || e <= s) return e <= s ? (t >= s ? 100 : 0) : 100;
  return ((t - s) / (e - s)) * 100;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------
/**
 * Compute PV/EV/AC/BAC/SPI/CPI/EAC for a snapshot date.
 *
 * BAC = sum of budgets.current_amount
 * Task budget share = task.budgeted_amount when set, else even split of BAC.
 *   (Even split is applied only across tasks that lack a budgeted_amount and
 *    only against the residual after subtracting explicit shares.)
 * PV(task) = share * plannedPct(snapshot) / 100
 * EV(task) = share * task.progress_pct / 100
 * AC       = actualCost (from budgets.actual_amount + optional accrual)
 * SPI = EV/PV (null if PV=0), CPI = EV/AC (null if AC=0)
 * EAC = BAC/CPI (null if CPI null or 0)
 */
export function computeEvm(input: {
  bac: number;
  tasks: EvmTaskInput[];
  snapshotDate: string;
  actualCost: number;
}): EvmComputation {
  const { bac, tasks, snapshotDate, actualCost } = input;

  // Split tasks into explicit vs implicit (even-split) shares.
  const explicit = tasks.filter((t) => t.budgeted_amount != null && t.budgeted_amount > 0);
  const implicit = tasks.filter((t) => t.budgeted_amount == null || (t.budgeted_amount ?? 0) <= 0);

  const explicitSum = explicit.reduce((s, t) => s + (t.budgeted_amount ?? 0), 0);
  const residual = Math.max(0, bac - explicitSum);
  const evenShare = implicit.length > 0 ? residual / implicit.length : 0;

  const shareFor = (t: EvmTaskInput) =>
    t.budgeted_amount != null && t.budgeted_amount > 0 ? t.budgeted_amount : evenShare;

  let pv = 0;
  let ev = 0;
  for (const t of tasks) {
    const share = shareFor(t);
    const planned = plannedPercentAtDate(t.start_date, t.end_date, snapshotDate);
    const progress = clamp(t.progress_pct, 0, 100);
    pv += share * (planned / 100);
    ev += share * (progress / 100);
  }

  const ac = Math.max(0, actualCost);
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi != null && cpi > 0 ? bac / cpi : null;

  return {
    bac: round2(bac),
    pv: round2(pv),
    ev: round2(ev),
    ac: round2(ac),
    spi: spi == null ? null : round3(spi),
    cpi: cpi == null ? null : round3(cpi),
    eac: eac == null ? null : round2(eac),
    taskCount: tasks.length,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Index thresholds (SPI / CPI health)
// ---------------------------------------------------------------------------
export type IndexHealth = "good" | "warn" | "bad" | "unknown";

export function indexHealth(value: number | null | undefined): IndexHealth {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value >= 1) return "good";
  if (value >= 0.9) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const captureEvmSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  includeAccruals: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});
export type CaptureEvmSnapshotInput = z.infer<typeof captureEvmSnapshotSchema>;

export const listEvmSnapshotsSchema = z.object({
  projectId: z.string().uuid(),
});
