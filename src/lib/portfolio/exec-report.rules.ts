// P-255 — Executive portfolio report: pure shapes and math.
//
// Doctrine notes that hold here:
//   • The document is ALWAYS English (P-244): NEPCO/lender-facing artefacts do
//     not follow the UI locale. The footer says so, in the document itself.
//   • The generator is a pure function of this DTO, so the scheduled-reports
//     cron can call it headlessly later (company_id + period → PDF bytes).
//   • Nothing here touches the DOM, jsPDF, Supabase or i18n.

import type { CurveMonth } from "@/lib/portfolio/cash-curve.rules";
import type { PortfolioExposure } from "@/lib/portfolio/exposure.rules";
import type {
  PortfolioGateRow,
  PortfolioKpis,
  PortfolioProjectCard,
} from "@/lib/portfolio.functions";

export const CONFIDENTIALITY_NOTE =
  "Confidential — for internal, client and lender use only. Do not redistribute.";

export const LIVE_DATA_STAMP = "Generated from live data";

export const LANGUAGE_NOTE =
  "This report is issued in English regardless of the application interface language.";

export interface ExecReportPeriod {
  /** First day of the earliest month in scope (YYYY-MM-DD). */
  start: string;
  /** First day of the latest month in scope (YYYY-MM-DD). */
  end: string;
}

export interface ExecReportBranding {
  primaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoSignedUrl: string | null;
}

export interface ExecReportRowCounts {
  projects: number;
  gates: number;
  curve_months: number;
  exposure_projects: number;
}

/** Everything the PDF generator needs — serializable, no live handles. */
export interface PortfolioExecReportData {
  company: { id: string; name: string; legalName: string | null };
  branding: ExecReportBranding;
  period: ExecReportPeriod;
  generatedAt: string;
  generatedBy: string;
  baseCurrency: string;
  kpis: PortfolioKpis;
  cards: PortfolioProjectCard[];
  gates: PortfolioGateRow[];
  curve: CurveMonth[];
  exposure: PortfolioExposure;
  rowCounts: ExecReportRowCounts;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "Jul 2026" — English, locale-independent (the document is always English). */
export function monthLabel(iso: string, short = true): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  if (!m) return "—";
  const name = MONTHS[Number(m[2]) - 1] ?? "";
  if (!name) return "—";
  return `${short ? name.slice(0, 3) : name} ${m[1]}`;
}

export function periodLabel(period: ExecReportPeriod): string {
  if (!period?.start || !period?.end) return "—";
  const from = monthLabel(period.start);
  const to = monthLabel(period.end);
  return from === to ? from : `${from} – ${to}`;
}

/** Month window around a reference date: N months back, M months forward. */
export function periodFromWindow(reference: Date, back: number, forward: number): ExecReportPeriod {
  const iso = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const base = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1);
  return {
    start: iso(new Date(Date.UTC(new Date(base).getUTCFullYear(), new Date(base).getUTCMonth() - back, 1))),
    end: iso(new Date(Date.UTC(new Date(base).getUTCFullYear(), new Date(base).getUTCMonth() + forward, 1))),
  };
}

/** Performance thresholds shared with the dashboard tiles (P-252). */
export type PerfVerdict = "On track" | "Watch" | "Behind" | "No data";

export function perfVerdict(value: number | null | undefined): PerfVerdict {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "No data";
  const v = Number(value);
  if (v >= 0.95) return "On track";
  if (v >= 0.85) return "Watch";
  return "Behind";
}

export function fmtIndex(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(3);
}

/** Safe file name: GSI_Portfolio_Executive_Report_2026-07.pdf */
export function execReportFilename(companyName: string, period: ExecReportPeriod): string {
  const slug = (companyName || "Company")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  const stamp = (period?.end ?? "").slice(0, 7) || "period";
  return `${slug || "Company"}_Portfolio_Executive_Report_${stamp}.pdf`;
}

// ---------------------------------------------------------------------------
// Chart geometry (pure) — the PDF draws vectors, so no browser rendering is
// needed and the scheduled cron can produce the identical chart headlessly.

export interface ChartScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** A "nice" axis covering [min,max], always including zero. */
export function niceScale(values: readonly number[], targetTicks = 4): ChartScale {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...(finite.length ? finite : [0]));
  let hi = Math.max(0, ...(finite.length ? finite : [0]));
  if (lo === hi) {
    hi = hi === 0 ? 1 : hi * 1.2;
    lo = Math.min(0, lo);
  }
  const rawStep = (hi - lo) / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const norm = rawStep / mag;
  const stepMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = stepMul * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return { min, max, step, ticks };
}

export interface ChartSeries {
  months: string[];
  forecast: number[];
  actual: number[];
  scale: ChartScale;
}

/** Monthly net forecast vs actual, ready to plot. */
export function chartSeries(curve: readonly CurveMonth[]): ChartSeries {
  const months = curve.map((m) => m.month);
  const forecast = curve.map((m) => Number(m.forecast_net ?? 0));
  const actual = curve.map((m) => Number(m.actual_net ?? 0));
  return { months, forecast, actual, scale: niceScale([...forecast, ...actual]) };
}

/** Map a value onto a pixel/point y coordinate inside a plot box. */
export function plotY(value: number, scale: ChartScale, top: number, height: number): number {
  const span = scale.max - scale.min || 1;
  const ratio = (value - scale.min) / span;
  return top + height - ratio * height;
}

export function plotX(index: number, count: number, left: number, width: number): number {
  if (count <= 1) return left + width / 2;
  return left + (index / (count - 1)) * width;
}

/** Totals row for the monthly cash table. */
export function curveTotals(curve: readonly CurveMonth[]): CurveMonth {
  return curve.reduce<CurveMonth>(
    (acc, m) => ({
      month: "total",
      forecast_inflow: acc.forecast_inflow + Number(m.forecast_inflow ?? 0),
      forecast_outflow: acc.forecast_outflow + Number(m.forecast_outflow ?? 0),
      actual_inflow: acc.actual_inflow + Number(m.actual_inflow ?? 0),
      actual_outflow: acc.actual_outflow + Number(m.actual_outflow ?? 0),
      forecast_net: acc.forecast_net + Number(m.forecast_net ?? 0),
      actual_net: acc.actual_net + Number(m.actual_net ?? 0),
    }),
    {
      month: "total",
      forecast_inflow: 0,
      forecast_outflow: 0,
      actual_inflow: 0,
      actual_outflow: 0,
      forecast_net: 0,
      actual_net: 0,
    },
  );
}

export function countRows(data: {
  cards: unknown[];
  gates: unknown[];
  curve: unknown[];
  exposure: { by_project: unknown[] };
}): ExecReportRowCounts {
  return {
    projects: data.cards.length,
    gates: data.gates.length,
    curve_months: data.curve.length,
    exposure_projects: data.exposure.by_project.length,
  };
}
