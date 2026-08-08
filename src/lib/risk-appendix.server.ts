// GC-17 — Close-pack / management-pack appendix for governed risk & contingency.
//
// Read-only projection over the governed workspace. Nothing is recomputed here
// beyond what the approved simulation run already froze: assumptions, input
// checksum, engine provenance, ranges, adequacy, drawdown reconciliation and
// open alerts.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  loadPortfolioRiskContingency,
  loadRiskContingencyWorkspace,
  type PortfolioRiskSummary,
} from "@/lib/risk-contingency.server";
import type { AdequacyResult, ReconciliationResult, SimResult } from "@/lib/risk-sim.rules";

export const RISK_APPENDIX_DISCLAIMER =
  "Quantitative ranges are simulation outputs from the approved run only. They are derived, non-posting figures and never mutate cost, commitment, EVM, cash, revenue or contract records.";

export interface RiskContingencyAppendix {
  scope: "project";
  basis: "approved" | "indicative";
  disclaimer: string;
  project_id: string;
  reporting_currency: string;
  watermark: string | null;
  provenance: {
    run_id: string | null;
    status: string | null;
    seed: number | null;
    iterations: number | null;
    engine: string | null;
    engine_version: string | null;
    input_checksum: string | null;
    fx_rate_date: string | null;
    fx_provenance: Record<string, { rate: number; date: string | null; source: string }>;
    approved_at: string | null;
    approved_by: string | null;
    assumptions: string | null;
    exclusions: string | null;
  };
  ranges: {
    cost: { p50: number; p80: number; p90: number; mean: number } | null;
    schedule_days: { p50: number; p80: number; p90: number; mean: number } | null;
    prob_exceeds_budget: number | null;
    prob_exceeds_finish: number | null;
    converged: boolean | null;
  };
  top_contributors: { risk_id: string; title: string; contribution: number; share_pct: number }[];
  adequacy: AdequacyResult;
  contingency: {
    available: number;
    management_reserve: number;
    reconciliation: ReconciliationResult;
    burn_per_day: number;
    unlinked_drawdowns: number;
  };
  open_alerts: { family: string; severity: string; title: string; due_date: string | null }[];
  input_problems: string[];
  missing_fx: string[];
}

export async function loadRiskContingencyAppendix(
  ctx: AuthContext,
  projectId: string,
): Promise<RiskContingencyAppendix> {
  const ws = await loadRiskContingencyWorkspace(ctx, projectId);
  const run = ws.approved_run;
  const results = (run?.results ?? null) as SimResult | null;

  return {
    scope: "project",
    basis: run ? "approved" : "indicative",
    disclaimer: RISK_APPENDIX_DISCLAIMER,
    project_id: projectId,
    reporting_currency: ws.reporting_currency,
    watermark: run ? null : "NO APPROVED RUN",
    provenance: {
      run_id: run?.id ?? null,
      status: run?.status ?? null,
      seed: run ? Number(run.seed) : null,
      iterations: run?.iterations ?? null,
      engine: run?.engine ?? null,
      engine_version: run?.engine_version ?? null,
      input_checksum: run?.input_checksum ?? null,
      fx_rate_date: run?.fx_rate_date ?? null,
      fx_provenance: run?.fx_provenance ?? {},
      approved_at: run?.approved_at ?? null,
      approved_by: run?.approved_by ?? null,
      assumptions: run?.assumptions ?? null,
      exclusions: run?.exclusions ?? null,
    },
    ranges: {
      cost: results
        ? {
            p50: results.cost.p50,
            p80: results.cost.p80,
            p90: results.cost.p90,
            mean: results.cost.mean,
          }
        : null,
      schedule_days: results?.schedule
        ? {
            p50: results.schedule.p50,
            p80: results.schedule.p80,
            p90: results.schedule.p90,
            mean: results.schedule.mean,
          }
        : null,
      prob_exceeds_budget: results?.prob_exceeds_budget ?? null,
      prob_exceeds_finish: results?.prob_exceeds_finish ?? null,
      converged: results?.converged ?? null,
    },
    top_contributors: (results?.tornado ?? []).slice(0, 10).map((t) => ({
      risk_id: t.risk_id,
      title: t.title,
      contribution: t.mean_contribution,
      share_pct: t.share_pct,
    })),
    adequacy: ws.adequacy,
    contingency: {
      available: ws.contingency.available,
      management_reserve: ws.contingency.management_reserve,
      reconciliation: ws.contingency.reconciliation,
      burn_per_day: ws.contingency.burn.per_day,
      unlinked_drawdowns: ws.contingency.unlinked_drawdowns,
    },
    open_alerts: ws.alerts
      .filter((a) => a.status !== "resolved")
      .map((a) => ({
        family: a.family,
        severity: a.severity,
        title: a.title,
        due_date: a.due_date ?? null,
      })),
    input_problems: ws.input_problems,
    missing_fx: ws.missing_fx,
  };
}

export async function loadPortfolioRiskAppendix(ctx: AuthContext): Promise<PortfolioRiskSummary> {
  return loadPortfolioRiskContingency(ctx);
}
