// P-100 — Commissioning KPI dashboard rules & pure helpers.
import { z } from "zod";

export const getCommissioningKpisInput = z.object({
  projectId: z.string().uuid(),
});

export const KPI_READ_ROLES = new Set([
  "construction_admin",
  "om_admin",
  "project_admin",
  "company_admin",
  "client_viewer",
  "lender_viewer",
  "engineer",
]);

export type PunchCategory = "A" | "B" | "C";
export const PUNCH_CATEGORIES: PunchCategory[] = ["A", "B", "C"];

export interface McCodKpi {
  state: "empty" | "mc_only" | "complete";
  mc_date: string | null;
  cod_date: string | null;
  projected_cod: string | null;
  days: number | null;
  elapsed_since_mc: number | null;
}

export interface PrAtCodKpi {
  source: "certificate" | "performance_test" | null;
  measured: number | null;
  contract: number | null;
  delta: number | null;
  passing: boolean;
}

export interface PunchCategoryRollup {
  category: PunchCategory;
  total: number;
  closed: number;
  open_refs: string[];
}

export interface AvailabilityKpi {
  state: "awaiting_scada" | "ready";
  cod_date: string | null;
}

export interface TestSummaryEntry {
  test_type: string;
  passed: number;
  failed: number;
  in_progress: number;
  not_started: number;
}

export interface TurnoverStatusChip {
  status: string;
  compiled_at: string | null;
  delivered_at: string | null;
}

export interface CommissioningKpisPayload {
  project: { id: string; name: string; code: string | null; phase: string };
  mcCod: McCodKpi;
  prAtCod: PrAtCodKpi;
  punchClosure: PunchCategoryRollup[];
  availability: AvailabilityKpi;
  testSummary: TestSummaryEntry[];
  turnoverStatus: TurnoverStatusChip | null;
  permissions: { canRead: boolean };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function computeMcCod(input: {
  mcDate: string | null;
  codDate: string | null;
  targetCod: string | null;
  now?: Date;
}): McCodKpi {
  const now = input.now ?? new Date();
  const mc = input.mcDate ? parseDate(input.mcDate) : null;
  const cod = input.codDate ? parseDate(input.codDate) : null;

  if (!mc) {
    return {
      state: "empty",
      mc_date: null,
      cod_date: null,
      projected_cod: input.targetCod,
      days: null,
      elapsed_since_mc: null,
    };
  }
  if (mc && cod) {
    return {
      state: "complete",
      mc_date: input.mcDate,
      cod_date: input.codDate,
      projected_cod: input.targetCod,
      days: diffDays(mc, cod),
      elapsed_since_mc: null,
    };
  }
  return {
    state: "mc_only",
    mc_date: input.mcDate,
    cod_date: null,
    projected_cod: input.targetCod,
    days: null,
    elapsed_since_mc: diffDays(mc, now),
  };
}

export function pickPrAtCod(input: {
  certificate: { pr_at_cod: number | null } | null;
  latestPerfTest: { measured_value: number | null; contract_value: number | null } | null;
  contractPr: number | null;
}): PrAtCodKpi {
  const contract = input.certificate
    ? input.contractPr
    : (input.latestPerfTest?.contract_value ?? input.contractPr);

  if (input.certificate && input.certificate.pr_at_cod != null) {
    const measured = Number(input.certificate.pr_at_cod);
    const c = contract != null ? Number(contract) : null;
    return {
      source: "certificate",
      measured,
      contract: c,
      delta: c != null ? +(measured - c).toFixed(3) : null,
      passing: c != null ? measured >= c : false,
    };
  }
  const t = input.latestPerfTest;
  if (t && t.measured_value != null && t.contract_value != null) {
    const measured = Number(t.measured_value);
    const c = Number(t.contract_value);
    return {
      source: "performance_test",
      measured,
      contract: c,
      delta: +(measured - c).toFixed(3),
      passing: measured >= c,
    };
  }
  return {
    source: null,
    measured: null,
    contract: contract != null ? Number(contract) : null,
    delta: null,
    passing: false,
  };
}

export function rollupPunchClosure(
  rows: { category: PunchCategory; status: string; punch_number: string | null }[],
): PunchCategoryRollup[] {
  const acc: Record<PunchCategory, PunchCategoryRollup> = {
    A: { category: "A", total: 0, closed: 0, open_refs: [] },
    B: { category: "B", total: 0, closed: 0, open_refs: [] },
    C: { category: "C", total: 0, closed: 0, open_refs: [] },
  };
  for (const r of rows) {
    const bucket = acc[r.category];
    if (!bucket) continue;
    bucket.total += 1;
    if (r.status === "closed") bucket.closed += 1;
    else if (r.punch_number) bucket.open_refs.push(r.punch_number);
  }
  return PUNCH_CATEGORIES.map((c) => acc[c]);
}

export function serializeKpisCsv(k: CommissioningKpisPayload): string {
  const rows: string[][] = [
    ["metric", "value", "detail"],
    [
      "MC to COD (days)",
      k.mcCod.days != null ? String(k.mcCod.days) : "—",
      k.mcCod.state === "mc_only"
        ? `elapsed_since_mc=${k.mcCod.elapsed_since_mc ?? "—"}; projected_cod=${k.mcCod.projected_cod ?? "—"}`
        : k.mcCod.state === "empty"
          ? "MC not signed"
          : `mc=${k.mcCod.mc_date}; cod=${k.mcCod.cod_date}`,
    ],
    [
      "PR at COD (%)",
      k.prAtCod.measured != null ? k.prAtCod.measured.toFixed(2) : "—",
      `source=${k.prAtCod.source ?? "none"}; contract=${k.prAtCod.contract ?? "—"}; passing=${k.prAtCod.passing}`,
    ],
    ...k.punchClosure.map((p) => [
      `Punch closure ${p.category}`,
      p.total > 0 ? `${Math.round((p.closed / p.total) * 100)}%` : "—",
      `${p.closed}/${p.total} closed`,
    ]),
    [
      "First-30-days availability",
      k.availability.state === "awaiting_scada" ? "awaiting SCADA" : "—",
      k.availability.cod_date ? `cod=${k.availability.cod_date}` : "no COD yet",
    ],
    ...k.testSummary.map((t) => [
      `Tests: ${t.test_type}`,
      `passed=${t.passed}`,
      `failed=${t.failed}; in_progress=${t.in_progress}; not_started=${t.not_started}`,
    ]),
    [
      "Turnover status",
      k.turnoverStatus?.status ?? "—",
      k.turnoverStatus
        ? `compiled_at=${k.turnoverStatus.compiled_at ?? "—"}; delivered_at=${k.turnoverStatus.delivered_at ?? "—"}`
        : "no package",
    ],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------
function parseDate(s: string): Date {
  // YYYY-MM-DD or ISO; treat as UTC midnight to avoid TZ drift.
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return d;
}
function diffDays(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
