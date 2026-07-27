// P-231 — Pure reporting + labor-cost math for timesheets.
// PURE module: no React, no Supabase, no I/O. Everything here is deterministic
// so the aggregations that feed payroll, estimate-vs-actual and EVM can be
// unit-tested offline.
import { ACTIVITY_LABELS, type TimesheetActivity } from "@/lib/timesheets/policy";

export const GENERAL_DISCIPLINE = "general";

/** Every KPI carries its formula so the tooltip and the code cannot drift. */
export const REPORT_FORMULAS = {
  totalHours: "Σ hours on approved timesheets in the selected period",
  overtimePct: "Σ overtime hours ÷ Σ total hours × 100",
  backlog: "Count of timesheets currently in review",
  leaveYtd: "Σ days of approved leave requests this calendar year",
  laborCost: "Σ (hours × resolved hourly rate); rate = entry rate, else profile default",
} as const;

export interface ReportEntry {
  timesheet_id: string;
  user_id: string;
  week_start: string;
  status: string;
  work_date: string;
  project_id: string | null;
  cwp_id: string | null;
  activity: string;
  hours: number;
  hourly_rate: number | null;
}

export interface RateContext {
  /** Fallback rate per user id, from profiles.default_hourly_rate. */
  defaultRates: Record<string, number | null | undefined>;
  /** discipline per cwp id; absent (or empty map) → general. */
  disciplines?: Record<string, string | null | undefined>;
}

export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** entry.hourly_rate → profiles.default_hourly_rate → null (missing rate). */
export function resolveRate(
  entry: Pick<ReportEntry, "user_id" | "hourly_rate">,
  ctx: RateContext,
): number | null {
  const own = entry.hourly_rate;
  if (own != null && Number.isFinite(Number(own))) return Number(own);
  const fallback = ctx.defaultRates?.[entry.user_id];
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  return null;
}

export function disciplineOf(entry: Pick<ReportEntry, "cwp_id">, ctx: RateContext): string {
  if (!entry.cwp_id) return GENERAL_DISCIPLINE;
  const d = ctx.disciplines?.[entry.cwp_id];
  return d && String(d).trim() ? String(d) : GENERAL_DISCIPLINE;
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

/** period = YYYY-MM → inclusive [from, to] ISO dates. Throws on bad input. */
export function monthRange(period: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error("period must be YYYY-MM");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error("period must be YYYY-MM");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

export function currentMonthRange(today = new Date()): { from: string; to: string } {
  const period = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  return monthRange(period);
}

export function yearRange(today = new Date()): { from: string; to: string } {
  const y = today.getUTCFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface ReportKpis {
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  overtime_pct: number;
  backlog_count: number;
  leave_days_ytd: number;
}

export function computeKpis(input: {
  entries: ReportEntry[];
  backlogCount: number;
  leaveDaysYtd: number;
}): ReportKpis {
  let overtime = 0;
  let total = 0;
  for (const e of input.entries) {
    const h = Number(e.hours) || 0;
    total += h;
    if (e.activity === "overtime") overtime += h;
  }
  return {
    total_hours: round2(total),
    regular_hours: round2(total - overtime),
    overtime_hours: round2(overtime),
    overtime_pct: total > 0 ? round2((overtime / total) * 100) : 0,
    backlog_count: input.backlogCount,
    leave_days_ytd: round2(input.leaveDaysYtd),
  };
}

// ---------------------------------------------------------------------------
// Per-person
// ---------------------------------------------------------------------------

export interface PersonReportRow {
  user_id: string;
  hours_by_activity: Record<string, number>;
  total_hours: number;
  overtime_hours: number;
  statuses: string[];
}

export function aggregatePerPerson(entries: ReportEntry[]): PersonReportRow[] {
  const acc = new Map<string, PersonReportRow & { statusSet: Set<string> }>();
  for (const e of entries) {
    let row = acc.get(e.user_id);
    if (!row) {
      row = {
        user_id: e.user_id,
        hours_by_activity: {},
        total_hours: 0,
        overtime_hours: 0,
        statuses: [],
        statusSet: new Set<string>(),
      };
      acc.set(e.user_id, row);
    }
    const h = Number(e.hours) || 0;
    row.hours_by_activity[e.activity] = round2((row.hours_by_activity[e.activity] ?? 0) + h);
    row.total_hours = round2(row.total_hours + h);
    if (e.activity === "overtime") row.overtime_hours = round2(row.overtime_hours + h);
    row.statusSet.add(e.status);
  }
  return [...acc.values()]
    .map(({ statusSet, ...row }) => ({ ...row, statuses: [...statusSet].sort() }))
    .sort((a, b) => b.total_hours - a.total_hours);
}

// ---------------------------------------------------------------------------
// Per-project (hours by person by discipline + labor cost)
// ---------------------------------------------------------------------------

export interface ProjectReportRow {
  project_id: string | null;
  user_id: string;
  discipline: string;
  hours: number;
  labor_cost: number;
  missing_rate_rows: number;
}

export function aggregatePerProject(entries: ReportEntry[], ctx: RateContext): ProjectReportRow[] {
  const acc = new Map<string, ProjectReportRow>();
  for (const e of entries) {
    const discipline = disciplineOf(e, ctx);
    const key = `${e.project_id ?? "-"}|${e.user_id}|${discipline}`;
    let row = acc.get(key);
    if (!row) {
      row = {
        project_id: e.project_id,
        user_id: e.user_id,
        discipline,
        hours: 0,
        labor_cost: 0,
        missing_rate_rows: 0,
      };
      acc.set(key, row);
    }
    const h = Number(e.hours) || 0;
    row.hours = round2(row.hours + h);
    const rate = resolveRate(e, ctx);
    if (rate == null) row.missing_rate_rows += 1;
    else row.labor_cost = round2(row.labor_cost + h * rate);
  }
  return [...acc.values()].sort((a, b) => b.hours - a.hours);
}

// ---------------------------------------------------------------------------
// Per-discipline × project matrix
// ---------------------------------------------------------------------------

export interface DisciplineMatrix {
  disciplines: string[];
  projects: (string | null)[];
  cells: Record<string, number>; // `${discipline}|${project_id ?? "-"}` → hours
  disciplineTotals: Record<string, number>;
  projectTotals: Record<string, number>;
  total: number;
}

export function buildDisciplineMatrix(entries: ReportEntry[], ctx: RateContext): DisciplineMatrix {
  const cells: Record<string, number> = {};
  const disciplineTotals: Record<string, number> = {};
  const projectTotals: Record<string, number> = {};
  const disciplines = new Set<string>();
  const projects = new Set<string>();
  let total = 0;
  for (const e of entries) {
    const d = disciplineOf(e, ctx);
    const p = e.project_id ?? "-";
    const h = Number(e.hours) || 0;
    disciplines.add(d);
    projects.add(p);
    cells[`${d}|${p}`] = round2((cells[`${d}|${p}`] ?? 0) + h);
    disciplineTotals[d] = round2((disciplineTotals[d] ?? 0) + h);
    projectTotals[p] = round2((projectTotals[p] ?? 0) + h);
    total = round2(total + h);
  }
  return {
    disciplines: [...disciplines].sort(),
    projects: [...projects].sort().map((p) => (p === "-" ? null : p)),
    cells,
    disciplineTotals,
    projectTotals,
    total,
  };
}

// ---------------------------------------------------------------------------
// Labor actuals (estimate-vs-actual + EVM source of truth)
// ---------------------------------------------------------------------------

export interface LaborActuals {
  project_id: string;
  period: string;
  regular_hours: number;
  overtime_hours: number;
  total_hours: number;
  labor_cost: number;
  missing_rate_rows: number;
}

export function aggregateLaborActuals(
  projectId: string,
  period: string,
  entries: ReportEntry[],
  ctx: RateContext,
): LaborActuals {
  let regular = 0;
  let overtime = 0;
  let cost = 0;
  let missing = 0;
  for (const e of entries) {
    const h = Number(e.hours) || 0;
    if (e.activity === "overtime") overtime += h;
    else regular += h;
    const rate = resolveRate(e, ctx);
    if (rate == null) missing += 1;
    else cost += h * rate;
  }
  return {
    project_id: projectId,
    period,
    regular_hours: round2(regular),
    overtime_hours: round2(overtime),
    total_hours: round2(regular + overtime),
    labor_cost: round2(cost),
    missing_rate_rows: missing,
  };
}

// ---------------------------------------------------------------------------
// Payroll CSV
// ---------------------------------------------------------------------------

/** Column order is a payroll contract — do not reorder. */
export const PAYROLL_COLUMNS = [
  "employee",
  "week_start",
  "project",
  "activity",
  "hours",
  "hourly_rate",
  "cost",
  "approval_status",
] as const;

export interface PayrollNameMaps {
  people: Record<string, string | undefined>;
  projects: Record<string, string | undefined>;
}

export function buildPayrollRows(
  entries: ReportEntry[],
  ctx: RateContext,
  names: PayrollNameMaps,
): (string | number)[][] {
  return entries
    .slice()
    .sort(
      (a, b) =>
        a.user_id.localeCompare(b.user_id) ||
        a.week_start.localeCompare(b.week_start) ||
        a.work_date.localeCompare(b.work_date),
    )
    .map((e) => {
      const rate = resolveRate(e, ctx);
      const hours = round2(Number(e.hours) || 0);
      return [
        names.people[e.user_id] ?? e.user_id,
        e.week_start,
        e.project_id ? (names.projects[e.project_id] ?? e.project_id) : "",
        e.activity,
        hours,
        rate == null ? "" : rate,
        rate == null ? "" : round2(hours * rate),
        e.status,
      ];
    });
}

export function activityLabel(activity: string): string {
  return ACTIVITY_LABELS[activity as TimesheetActivity] ?? activity;
}
