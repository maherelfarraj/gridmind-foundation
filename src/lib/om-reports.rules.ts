// P-110 — Pure math + text helpers for the monthly O&M report.
// No side effects; safe to unit-test.
import { z } from "zod";

export const OM_REPORT_TYPES = ["monthly", "quarterly", "annual"] as const;
export type OmReportType = (typeof OM_REPORT_TYPES)[number];

export const OM_REPORT_STATUSES = ["draft", "generated", "sent"] as const;
export type OmReportStatus = (typeof OM_REPORT_STATUSES)[number];

export const generateOmReportSchema = z.object({
  projectId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportType: z.enum(OM_REPORT_TYPES).default("monthly"),
});
export type GenerateOmReportInput = z.infer<typeof generateOmReportSchema>;

export const attachOmReportPdfSchema = z.object({
  reportId: z.string().uuid(),
  pdfPath: z.string().min(1).max(500),
});

// ---------------------------------------------------------------------------
// Sanitisers — reused by the PDF renderer so "O&M" stays clean.
// ---------------------------------------------------------------------------
export function sanitizeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&;/g, "&");
}

// ---------------------------------------------------------------------------
// Availability
// downtime_hours = ∑ alarm-open-window + ∑ corrective-WO labor hours,
// bounded to the period length.
// ---------------------------------------------------------------------------
export function computeAvailability(periodHours: number, downtimeHours: number): number | null {
  if (!Number.isFinite(periodHours) || periodHours <= 0) return null;
  const clamped = Math.max(0, Math.min(downtimeHours, periodHours));
  return 1 - clamped / periodHours;
}

// ---------------------------------------------------------------------------
// Performance ratio — actual metered energy vs irradiance-expected.
// PR = actual_kwh / (irradiance_kwh_per_m2 * capacity_kwp) → null on insufficient data.
// ---------------------------------------------------------------------------
export function computePerformanceRatio(input: {
  actualKwh: number | null;
  irradianceKwhPerM2: number | null;
  capacityKwp: number | null;
}): { value: number | null; reason: "ok" | "insufficient_data" } {
  const { actualKwh, irradianceKwhPerM2, capacityKwp } = input;
  if (
    actualKwh == null ||
    irradianceKwhPerM2 == null ||
    capacityKwp == null ||
    !Number.isFinite(actualKwh) ||
    !Number.isFinite(irradianceKwhPerM2) ||
    !Number.isFinite(capacityKwp) ||
    irradianceKwhPerM2 <= 0 ||
    capacityKwp <= 0
  ) {
    return { value: null, reason: "insufficient_data" };
  }
  const expected = irradianceKwhPerM2 * capacityKwp;
  return { value: actualKwh / expected, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Work-orders KPIs
// ---------------------------------------------------------------------------
export interface WorkOrderSlice {
  type: "preventive" | "corrective" | (string & {});
  status: string;
  createdAt: string;
  closedAt: string | null;
  totalCost: number;
}

export function computeWoSummary(rows: WorkOrderSlice[]): {
  opened: number;
  closed: number;
  mttrHours: number | null;
  preventive: number;
  corrective: number;
  pmCmRatio: number | null;
} {
  let opened = 0;
  let closed = 0;
  let mttrTotal = 0;
  let mttrCount = 0;
  let pm = 0;
  let cm = 0;
  for (const w of rows) {
    opened += 1;
    if (w.closedAt) {
      closed += 1;
      const t0 = Date.parse(w.createdAt);
      const t1 = Date.parse(w.closedAt);
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) {
        mttrTotal += (t1 - t0) / 36e5;
        mttrCount += 1;
      }
    }
    if (w.type === "preventive") pm += 1;
    else if (w.type === "corrective") cm += 1;
  }
  const total = pm + cm;
  return {
    opened,
    closed,
    mttrHours: mttrCount > 0 ? mttrTotal / mttrCount : null,
    preventive: pm,
    corrective: cm,
    pmCmRatio: total > 0 ? pm / total : null,
  };
}

// ---------------------------------------------------------------------------
// Spend by WO type
// ---------------------------------------------------------------------------
export function computeSpendByType(rows: WorkOrderSlice[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of rows) {
    const k = w.type ?? "other";
    out[k] = (out[k] ?? 0) + (Number.isFinite(w.totalCost) ? w.totalCost : 0);
  }
  return out;
}

export function formatCurrency(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${(currency ?? "USD").toUpperCase()} ${amount.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Alarms summary
// ---------------------------------------------------------------------------
export interface AlarmSlice {
  id: string;
  severity: string;
  raisedAt: string;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  ruleId: string | null;
  ruleName?: string | null;
}

export function computeAlarmSummary(rows: AlarmSlice[]): {
  total: number;
  bySeverity: Record<string, number>;
  meanAcknowledgeMinutes: number | null;
  topRecurring: Array<{
    ruleId: string | null;
    ruleName: string;
    count: number;
  }>;
} {
  const bySeverity: Record<string, number> = {};
  let ackTotal = 0;
  let ackCount = 0;
  const byRule = new Map<string, { ruleId: string | null; ruleName: string; count: number }>();
  for (const a of rows) {
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    if (a.acknowledgedAt) {
      const t0 = Date.parse(a.raisedAt);
      const t1 = Date.parse(a.acknowledgedAt);
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) {
        ackTotal += (t1 - t0) / 60_000;
        ackCount += 1;
      }
    }
    const key = a.ruleId ?? `unnamed:${a.ruleName ?? "n/a"}`;
    const cur = byRule.get(key) ?? {
      ruleId: a.ruleId,
      ruleName: a.ruleName ?? "Unnamed rule",
      count: 0,
    };
    cur.count += 1;
    byRule.set(key, cur);
  }
  const topRecurring = Array.from(byRule.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    total: rows.length,
    bySeverity,
    meanAcknowledgeMinutes: ackCount > 0 ? ackTotal / ackCount : null,
    topRecurring,
  };
}

// ---------------------------------------------------------------------------
// Alarm downtime — sum of (cleared_at - raised_at) for critical alarms,
// clamped to the period.
// ---------------------------------------------------------------------------
export function computeAlarmDowntimeHours(
  rows: AlarmSlice[],
  periodStartIso: string,
  periodEndIso: string,
): number {
  const pStart = Date.parse(periodStartIso);
  const pEnd = Date.parse(periodEndIso);
  if (!Number.isFinite(pStart) || !Number.isFinite(pEnd) || pEnd <= pStart) {
    return 0;
  }
  let acc = 0;
  for (const a of rows) {
    if (a.severity !== "critical") continue;
    const raised = Date.parse(a.raisedAt);
    if (!Number.isFinite(raised)) continue;
    const cleared = a.clearedAt ? Date.parse(a.clearedAt) : pEnd;
    const s = Math.max(raised, pStart);
    const e = Math.max(s, Math.min(cleared, pEnd));
    acc += (e - s) / 36e5;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Corrective-WO downtime — sum labor hours from work-order labor JSONB rows.
// ---------------------------------------------------------------------------
export function sumLaborHours(labor: unknown): number {
  if (!Array.isArray(labor)) return 0;
  let acc = 0;
  for (const l of labor as Array<{ hours?: number | string }>) {
    const h = Number(l?.hours ?? 0);
    if (Number.isFinite(h) && h > 0) acc += h;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------
export function omReportFilename(projectName: string, periodStart: string): string {
  const safeProj = (projectName || "project").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  const yyyymm = periodStart.slice(0, 7); // YYYY-MM
  return `GridMind_OM_Report_${safeProj}_${yyyymm}.pdf`;
}

// ---------------------------------------------------------------------------
// Snapshot shape stored in `data` jsonb.
// ---------------------------------------------------------------------------
export interface OmReportSnapshot {
  version: 1;
  periodHours: number;
  availability: {
    value: number | null;
    downtimeHours: number;
    alarmDowntimeHours: number;
    correctiveWoDowntimeHours: number;
  };
  performanceRatio: {
    value: number | null;
    reason: "ok" | "insufficient_data";
    actualKwh: number | null;
    irradianceKwhPerM2: number | null;
    capacityKwp: number | null;
  };
  alarms: ReturnType<typeof computeAlarmSummary>;
  workOrders: ReturnType<typeof computeWoSummary>;
  spend: {
    currency: string;
    byType: Record<string, number>;
    byTypeFormatted: Record<string, string>;
    total: number;
    totalFormatted: string;
  };
}
