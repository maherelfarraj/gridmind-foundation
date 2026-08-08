// GC-17 — Governed risk & contingency drawdown: I/O layer (never in *.functions.ts).
//
// All authoritative reads come from existing modules (risks, quantifications,
// contingency pools/movements, fx_rates). GC-17 only writes its own governed
// tables: risk_sim_runs, risk_contingency_events and risk_contingency_alerts.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveCostingFx } from "@/lib/costing.server";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";
import {
  alertDedupeKey,
  assessContingencyAdequacy,
  burnRate,
  canTransitionAlert,
  canTransitionSim,
  checksum,
  evaluateAlerts,
  reconcileContingency,
  runSimulation,
  SIM_ENGINE,
  SIM_ENGINE_VERSION,
  simRequestSchema,
  validateSimInputs,
  type AdequacyResult,
  type AlertCandidate,
  type AlertStatus,
  type Distribution,
  type DistributionKind,
  type ReconciliationResult,
  type SimRequest,
  type SimResult,
  type SimRiskInput,
  type SimStatus,
} from "@/lib/risk-sim.rules";

export const RC_WRITE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;
export const RC_APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

export interface RiskContingencyAccess {
  canWrite: boolean;
  canApprove: boolean;
}

export async function resolveRcAccess(ctx: AuthContext): Promise<RiskContingencyAccess> {
  const [canWrite, canApprove] = await Promise.all([
    hasAnyRole(ctx, RC_WRITE_ROLES),
    hasAnyRole(ctx, RC_APPROVE_ROLES),
  ]);
  return { canWrite, canApprove };
}

async function requireWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, RC_WRITE_ROLES))) {
    httpError(403, "forbidden", "Project controls or finance role required.");
  }
}

async function requireApprove(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, RC_APPROVE_ROLES))) {
    httpError(403, "forbidden", "Finance or company admin role required.");
  }
}

async function projectCompany(ctx: AuthContext, projectId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found", "Project not found in your company.");
  return (data as { company_id: string }).company_id;
}

async function logEvent(
  ctx: AuthContext,
  row: {
    company_id: string;
    project_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await ctx.supabase.from("risk_contingency_events").insert({
    company_id: row.company_id,
    project_id: row.project_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    payload: row.payload ?? {},
    actor_id: ctx.user?.id ?? null,
  } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Input assembly
// ---------------------------------------------------------------------------
interface QuantRow {
  risk_id: string;
  currency_code: string;
  cost_low: number | string;
  cost_most_likely: number | string;
  cost_high: number | string;
  probability_pct: number | string;
  schedule_days_impact: number | string;
  schedule_days_low: number | string | null;
  schedule_days_high: number | string | null;
  distribution_kind: DistributionKind | null;
  dist_sigma: number | string | null;
  discrete_points: unknown;
  correlation_group: string | null;
  risks: { title: string; status: string; category: string } | null;
}

function num(v: number | string | null | undefined, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v ?? fallback);
  return Number.isFinite(n) ? (n as number) : fallback;
}

export interface SimInputAssembly {
  risks: SimRiskInput[];
  problems: string[];
  missing_fx: string[];
  fx_provenance: Record<string, { rate: number; date: string | null; source: string }>;
}

/** Builds validated simulation inputs, preserving source currency + FX provenance. */
export async function assembleSimInputs(
  ctx: AuthContext,
  projectId: string,
  reportingCurrency: string,
  onDate: string,
): Promise<SimInputAssembly> {
  const { data, error } = await ctx.supabase
    .from("risk_quantifications")
    .select(
      "risk_id, currency_code, cost_low, cost_most_likely, cost_high, probability_pct, schedule_days_impact, schedule_days_low, schedule_days_high, distribution_kind, dist_sigma, discrete_points, correlation_group, risks(title, status, category)",
    )
    .eq("project_id", projectId)
    .limit(2000);
  if (error) throw error;

  const rows = ((data ?? []) as unknown as QuantRow[]).filter(
    (r) => r.risks && r.risks.status !== "closed" && r.risks.status !== "realized",
  );

  const currencies = Array.from(new Set(rows.map((r) => r.currency_code.toUpperCase())));
  const fxProvenance: SimInputAssembly["fx_provenance"] = {};
  const missingFx: string[] = [];
  for (const code of currencies) {
    if (code === reportingCurrency.toUpperCase()) {
      fxProvenance[code] = { rate: 1, date: onDate, source: "parity" };
      continue;
    }
    const fx = await resolveCostingFx(ctx, projectId, code, onDate);
    const rate = fx.fx_rate;
    if (fx.missing || rate === null || !(rate > 0)) {
      missingFx.push(code);
      continue;
    }
    fxProvenance[code] = { rate, date: fx.fx_rate_date, source: fx.fx_source };

  }

  const risks: SimRiskInput[] = [];
  for (const r of rows) {
    const code = r.currency_code.toUpperCase();
    const fx = fxProvenance[code];
    if (!fx) continue; // no silent fallback — surfaced through missing_fx
    const kind: DistributionKind = r.distribution_kind ?? "triangular";
    const cost: Distribution = {
      kind,
      low: num(r.cost_low),
      most_likely: num(r.cost_most_likely),
      high: num(r.cost_high),
      sigma: r.dist_sigma === null ? null : num(r.dist_sigma),
      points: Array.isArray(r.discrete_points)
        ? (r.discrete_points as { value: number; weight: number }[])
        : null,
    };
    const sMid = num(r.schedule_days_impact);
    const schedule: Distribution = {
      kind: kind === "discrete" || kind === "lognormal" ? "triangular" : kind,
      low: num(r.schedule_days_low, sMid),
      most_likely: sMid,
      high: Math.max(num(r.schedule_days_high, sMid), sMid),
      sigma: r.dist_sigma === null ? null : num(r.dist_sigma),
      points: null,
    };
    risks.push({
      risk_id: r.risk_id,
      title: r.risks?.title ?? "—",
      probability_pct: num(r.probability_pct),
      currency_code: code,
      fx_rate: fx.rate,
      cost,
      schedule,
      correlation_group: r.correlation_group,
      is_opportunity: (r.risks?.category ?? "") === "opportunity",
    });
  }

  return { risks, problems: validateSimInputs(risks), missing_fx: missingFx, fx_provenance: fxProvenance };
}

// ---------------------------------------------------------------------------
// Simulation lifecycle
// ---------------------------------------------------------------------------
export interface SimDiagnostics {
  converged: boolean;
  relative_precision: number;
  standard_error: number;
  correlation_groups: string[];
}

export interface SimRunRow {
  id: string;
  project_id: string;
  scope: string;
  status: SimStatus;
  seed: number;
  iterations: number;
  engine: string;
  engine_version: string;
  input_checksum: string;
  reporting_currency: string;
  fx_rate_date: string | null;
  fx_provenance: Record<string, { rate: number; date: string | null; source: string }>;
  assumptions: string | null;
  exclusions: string | null;
  results: SimResult | Record<string, never>;
  diagnostics: SimDiagnostics;
  row_version: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;

}

export async function createSimRun(ctx: AuthContext, input: SimRequest): Promise<SimRunRow> {
  await requireWrite(ctx);
  const req = simRequestSchema.parse(input);
  const companyId = await projectCompany(ctx, req.project_id);
  const onDate = req.fx_rate_date ?? new Date().toISOString().slice(0, 10);

  if (req.idempotency_key) {
    const { data: existing } = await ctx.supabase
      .from("risk_sim_runs")
      .select("*")
      .eq("project_id", req.project_id)
      .eq("idempotency_key", req.idempotency_key)
      .maybeSingle();
    if (existing) return existing as unknown as SimRunRow;
  }

  const assembly = await assembleSimInputs(
    ctx,
    req.project_id,
    req.reporting_currency,
    onDate,
  );
  if (assembly.missing_fx.length > 0) {
    httpError(
      422,
      "fx_missing",
      `No FX rate to ${req.reporting_currency} for ${assembly.missing_fx.join(", ")} on ${onDate}.`,
    );
  }
  if (assembly.problems.length > 0) {
    httpError(422, "invalid_inputs", assembly.problems.join(" "));
  }
  if (assembly.risks.length === 0) {
    httpError(422, "no_inputs", "No open quantified risks to simulate.");
  }

  const inputChecksum = checksum({
    risks: assembly.risks,
    seed: req.seed,
    iterations: req.iterations,
    scope: req.scope,
    reporting_currency: req.reporting_currency,
    engine: SIM_ENGINE,
    engine_version: SIM_ENGINE_VERSION,
  });

  const results = runSimulation(assembly.risks, {
    scope: req.scope,
    seed: req.seed,
    iterations: req.iterations,
    reporting_currency: req.reporting_currency,
    budget_threshold: req.budget_threshold,
    schedule_threshold_days: req.schedule_threshold_days,
  });

  const { data, error } = await ctx.supabase
    .from("risk_sim_runs")
    .insert({
      company_id: companyId,
      project_id: req.project_id,
      scope: req.scope,
      status: "draft",
      seed: req.seed,
      iterations: req.iterations,
      engine: SIM_ENGINE,
      engine_version: SIM_ENGINE_VERSION,
      input_checksum: inputChecksum,
      reporting_currency: req.reporting_currency,
      fx_rate_date: onDate,
      fx_provenance: assembly.fx_provenance,
      assumptions: req.assumptions,
      exclusions: req.exclusions,
      inputs: assembly.risks,
      results,
      diagnostics: {
        converged: results.converged,
        relative_precision: results.cost.relative_precision,
        standard_error: results.cost.standard_error,
        correlation_groups: results.correlation_groups,
      },
      idempotency_key: req.idempotency_key,
      created_by: ctx.user?.id ?? null,
    } as never)
    .select("*")
    .single();
  if (error) throw error;

  const row = data as unknown as SimRunRow;
  await logEvent(ctx, {
    company_id: companyId,
    project_id: req.project_id,
    entity_type: "sim_run",
    entity_id: row.id,
    action: "run",
    payload: { seed: req.seed, iterations: req.iterations, checksum: inputChecksum },
  });
  await audit(ctx, "risk_sim.run", "risk_sim_runs", row.id, {
    project_id: req.project_id,
    seed: req.seed,
    iterations: req.iterations,
  });
  return row;
}

export async function decideSimRun(
  ctx: AuthContext,
  input: { id: string; target: SimStatus; row_version: number; note?: string },
): Promise<void> {
  await requireApprove(ctx);
  const { data, error } = await ctx.supabase
    .from("risk_sim_runs")
    .select("id, company_id, project_id, status, row_version, created_by")
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Simulation run not found.");
  const run = data as unknown as {
    id: string;
    company_id: string;
    project_id: string;
    status: SimStatus;
    row_version: number;
    created_by: string | null;
  };

  if (run.row_version !== input.row_version) {
    httpError(409, "stale_row", "This run changed since you loaded it. Reload and retry.");
  }
  if (!canTransitionSim(run.status, input.target)) {
    httpError(422, "invalid_transition", `Cannot move ${run.status} → ${input.target}.`);
  }
  // Segregation of duties: the requester cannot approve their own run.
  if (input.target === "approved" && run.created_by && run.created_by === ctx.user?.id) {
    httpError(403, "sod_violation", "A simulation must be approved by someone other than its author.");
  }

  const patch: Record<string, unknown> = { status: input.target };
  if (input.target === "approved") {
    patch["approved_by"] = ctx.user?.id ?? null;
    patch["approved_at"] = new Date().toISOString();
    // Supersede any previously approved run for the project.
    const { data: prior } = await ctx.supabase
      .from("risk_sim_runs")
      .select("id")
      .eq("project_id", run.project_id)
      .eq("status", "approved");
    for (const p of (prior ?? []) as { id: string }[]) {
      if (p.id === run.id) continue;
      await ctx.supabase
        .from("risk_sim_runs")
        .update({ status: "superseded", superseded_by: run.id } as never)
        .eq("id", p.id);
    }
  }

  const { error: upErr } = await ctx.supabase
    .from("risk_sim_runs")
    .update(patch as never)
    .eq("id", run.id)
    .eq("row_version", input.row_version);
  if (upErr) throw upErr;

  await logEvent(ctx, {
    company_id: run.company_id,
    project_id: run.project_id,
    entity_type: "sim_run",
    entity_id: run.id,
    action: input.target,
    payload: { note: input.note ?? "" },
  });
  await audit(ctx, `risk_sim.${input.target}`, "risk_sim_runs", run.id, {
    project_id: run.project_id,
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export interface AlertRow {
  id: string;
  project_id: string | null;
  family: string;
  severity: string;
  status: AlertStatus;
  dedupe_key: string;
  title: string;
  detail: string | null;
  owner_id: string | null;
  due_date: string | null;
  snoozed_until: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

/** Upserts derived alerts into the shared register, de-duplicated by key. */
export async function syncAlerts(
  ctx: AuthContext,
  companyId: string,
  candidates: AlertCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows = candidates.map((c) => ({
    company_id: companyId,
    project_id: c.project_id,
    family: c.family,
    severity: c.severity,
    dedupe_key: alertDedupeKey(c.family, c.project_id, c.subject),
    title: c.title,
    detail: c.detail,
    evidence_entity_type: c.evidence_entity_type ?? null,
    evidence_entity_id: c.evidence_entity_id ?? null,
    payload: c.payload ?? {},
  }));
  const { data: existing, error: exErr } = await ctx.supabase
    .from("risk_contingency_alerts")
    .select("dedupe_key")
    .eq("company_id", companyId)
    .in(
      "dedupe_key",
      rows.map((r) => r.dedupe_key),
    );
  if (exErr) throw exErr;
  const known = new Set(((existing ?? []) as { dedupe_key: string }[]).map((r) => r.dedupe_key));
  const fresh = rows.filter((r) => !known.has(r.dedupe_key));
  if (fresh.length === 0) return 0;
  const { error } = await ctx.supabase.from("risk_contingency_alerts").insert(fresh as never);
  if (error) throw error;
  return fresh.length;
}

export async function decideAlert(
  ctx: AuthContext,
  input: {
    id: string;
    target: AlertStatus;
    row_version: number;
    snoozed_until?: string | null;
    owner_id?: string | null;
    due_date?: string | null;
  },
): Promise<void> {
  await requireWrite(ctx);
  const { data, error } = await ctx.supabase
    .from("risk_contingency_alerts")
    .select("id, company_id, project_id, status, row_version")
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Alert not found.");
  const alert = data as unknown as {
    id: string;
    company_id: string;
    project_id: string | null;
    status: AlertStatus;
    row_version: number;
  };
  if (alert.row_version !== input.row_version) {
    httpError(409, "stale_row", "This alert changed since you loaded it.");
  }
  if (!canTransitionAlert(alert.status, input.target)) {
    httpError(422, "invalid_transition", `Cannot move ${alert.status} → ${input.target}.`);
  }

  const patch: Record<string, unknown> = {
    status: input.target,
    row_version: alert.row_version + 1,
  };
  if (input.target === "acknowledged") {
    patch["acknowledged_by"] = ctx.user?.id ?? null;
    patch["acknowledged_at"] = new Date().toISOString();
  }
  if (input.target === "snoozed") patch["snoozed_until"] = input.snoozed_until ?? null;
  if (input.target === "resolved") patch["resolved_at"] = new Date().toISOString();
  if (input.target === "open") patch["resolved_at"] = null;
  if (input.owner_id !== undefined) patch["owner_id"] = input.owner_id;
  if (input.due_date !== undefined) patch["due_date"] = input.due_date;

  const { error: upErr } = await ctx.supabase
    .from("risk_contingency_alerts")
    .update(patch as never)
    .eq("id", alert.id)
    .eq("row_version", alert.row_version);
  if (upErr) throw upErr;

  if (alert.project_id) {
    await logEvent(ctx, {
      company_id: alert.company_id,
      project_id: alert.project_id,
      entity_type: "alert",
      entity_id: alert.id,
      action: input.target,
    });
  }
  await audit(ctx, `risk_alert.${input.target}`, "risk_contingency_alerts", alert.id, {});
}

// ---------------------------------------------------------------------------
// Workspace read
// ---------------------------------------------------------------------------
export interface RiskContingencyWorkspace {
  project_id: string;
  reporting_currency: string;
  access: RiskContingencyAccess;
  approved_run: SimRunRow | null;
  runs: SimRunRow[];
  contingency: {
    available: number;
    management_reserve: number;
    reconciliation: ReconciliationResult;
    burn: { total: number; per_day: number; spike: boolean };
    unlinked_drawdowns: number;
  };
  adequacy: AdequacyResult;
  register: {
    risk_id: string;
    title: string;
    category: string;
    status: string;
    probability: number;
    impact: number;
    score: number;
    owner_name: string | null;
    next_review_date: string | null;
    escalated: boolean;
    quantified: boolean;
  }[];
  alerts: AlertRow[];
  events: {
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    created_at: string;
  }[];
  input_problems: string[];
  missing_fx: string[];
}

export async function loadRiskContingencyWorkspace(
  ctx: AuthContext,
  projectId: string,
): Promise<RiskContingencyWorkspace> {
  const companyId = await projectCompany(ctx, projectId);
  const today = new Date();
  const onDate = today.toISOString().slice(0, 10);

  const [runsRes, poolsRes, movesRes, risksRes, alertsRes, eventsRes, access] = await Promise.all([
    ctx.supabase
      .from("risk_sim_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.supabase.from("contingency_pools").select("*").eq("project_id", projectId).limit(200),
    ctx.supabase
      .from("contingency_movements")
      .select("*")
      .eq("project_id", projectId)
      .limit(2000),
    ctx.supabase
      .from("risks")
      .select(
        "id, title, category, status, probability, impact, score, next_review_date, escalated, target_close_date, owner_id, profiles:owner_id(full_name)",
      )
      .eq("project_id", projectId)
      .limit(1000),
    ctx.supabase
      .from("risk_contingency_alerts")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
    ctx.supabase
      .from("risk_contingency_events")
      .select("id, entity_type, entity_id, action, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100),
    resolveRcAccess(ctx),
  ]);
  for (const res of [runsRes, poolsRes, movesRes, risksRes, alertsRes, eventsRes]) {
    if (res.error) throw res.error;
  }

  const runs = (runsRes.data ?? []) as unknown as SimRunRow[];
  const approved = runs.find((r) => r.status === "approved") ?? null;

  type Pool = {
    id: string;
    currency_code: string;
    original_amount: number | string;
    is_management_reserve: boolean;
    reserve_expires_on: string | null;
    status: string;
  };
  type Move = {
    pool_id: string;
    kind: string;
    amount: number | string;
    status: string;
    effective_date: string;
    risk_id: string | null;
    change_order_id: string | null;
  };
  const pools = (poolsRes.data ?? []) as unknown as Pool[];
  const moves = ((movesRes.data ?? []) as unknown as Move[]).map((m) => ({
    ...m,
    amount: num(m.amount),
  }));
  const reservePoolIds = new Set(pools.filter((p) => p.is_management_reserve).map((p) => p.id));

  const approvedMoves = moves.filter((m) => m.status === "approved");
  const sumKind = (kind: string, reserve: boolean) =>
    approvedMoves
      .filter((m) => m.kind === kind && reservePoolIds.has(m.pool_id) === reserve)
      .reduce((s, m) => s + m.amount, 0);

  const workingOpening = pools
    .filter((p) => !p.is_management_reserve)
    .reduce((s, p) => s + num(p.original_amount), 0);
  const reserveOpening = pools
    .filter((p) => p.is_management_reserve)
    .reduce((s, p) => s + num(p.original_amount), 0);

  const reconciliation = reconcileContingency({
    opening: workingOpening,
    additions: 0,
    transfers_in: sumKind("transfer_in", false),
    transfers_out: sumKind("transfer_out", false),
    drawdowns: sumKind("draw", false),
    releases: sumKind("release", false),
  });

  const burn = burnRate(
    approvedMoves
      .filter((m) => m.kind === "draw")
      .map((m) => ({ effective_date: m.effective_date, amount: m.amount })),
    today,
  );
  const unlinked = approvedMoves.filter(
    (m) => m.kind === "draw" && !m.risk_id && !m.change_order_id,
  ).length;

  const results = (approved?.results ?? null) as SimResult | null;
  const adequacy = assessContingencyAdequacy({
    available: reconciliation.closing,
    management_reserve: reserveOpening,
    p50: results?.cost.p50 ?? 0,
    p80: results?.cost.p80 ?? 0,
    p90: results?.cost.p90 ?? 0,
  });

  type RiskRow = {
    id: string;
    title: string;
    category: string;
    status: string;
    probability: number;
    impact: number;
    score: number;
    next_review_date: string | null;
    escalated: boolean;
    target_close_date: string | null;
    profiles: { full_name: string | null } | null;
  };
  const riskRows = (risksRes.data ?? []) as unknown as RiskRow[];
  const quantifiedIds = new Set((results?.tornado ?? []).map((t) => t.risk_id));

  const assembly = await assembleSimInputs(ctx, projectId, approved?.reporting_currency ?? "USD", onDate);

  const overdue = riskRows.filter((r) => {
    if (r.status === "closed") return false;
    const due = r.next_review_date ?? r.target_close_date;
    return !!due && Date.parse(due) < today.getTime();
  }).length;

  const reserveExpiring = pools.filter(
    (p) =>
      p.is_management_reserve &&
      p.reserve_expires_on &&
      Date.parse(p.reserve_expires_on) - today.getTime() < 60 * 86_400_000,
  ).length;

  const candidates = evaluateAlerts({
    project_id: projectId,
    adequacy,
    sim: {
      ran_at: approved?.approved_at ?? null,
      prob_exceeds_budget: results?.prob_exceeds_budget ?? null,
      prob_exceeds_finish: results?.prob_exceeds_finish ?? null,
      converged: results?.converged ?? true,
      top_contributor: results?.tornado[0]?.title ?? null,
      top_contributor_id: results?.tornado[0]?.risk_id ?? null,
    },
    burn,
    unlinked_drawdowns: unlinked,
    overdue_mitigations: overdue,
    input_problems: assembly.problems.length,
    missing_fx: assembly.missing_fx.length,
    reserve_expiring: reserveExpiring,
    now: today,
  });
  if (access.canWrite) {
    try {
      await syncAlerts(ctx, companyId, candidates);
    } catch {
      // Alert persistence must never break the cockpit read.
    }
  }

  const alerts = (alertsRes.data ?? []) as unknown as AlertRow[];

  return {
    project_id: projectId,
    reporting_currency: approved?.reporting_currency ?? pools[0]?.currency_code ?? "USD",
    access,
    approved_run: approved,
    runs,
    contingency: {
      available: reconciliation.closing,
      management_reserve: reserveOpening,
      reconciliation,
      burn,
      unlinked_drawdowns: unlinked,
    },
    adequacy,
    register: riskRows.map((r) => ({
      risk_id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      probability: r.probability,
      impact: r.impact,
      score: r.score,
      owner_name: r.profiles?.full_name ?? null,
      next_review_date: r.next_review_date,
      escalated: r.escalated,
      quantified: quantifiedIds.has(r.id),
    })),
    alerts,
    events: (eventsRes.data ?? []) as unknown as RiskContingencyWorkspace["events"],
    input_problems: assembly.problems,
    missing_fx: assembly.missing_fx,
  };
}

// ---------------------------------------------------------------------------
// Portfolio read
// ---------------------------------------------------------------------------
export interface PortfolioRiskRow {
  project_id: string;
  project_name: string;
  project_code: string | null;
  reporting_currency: string;
  p50: number;
  p80: number;
  p90: number;
  available: number;
  cover_p80: number | null;
  shortfall: number;
  band: AdequacyResult["band"];
  burn_per_day: number;
  open_alerts: number;
  last_run_at: string | null;
  top_contributor: string | null;
}

export interface PortfolioRiskSummary {
  rows: PortfolioRiskRow[];
  totals: { p80: number; available: number; shortfall: number; projects: number };
  alerts: AlertRow[];
}

export async function loadPortfolioRiskContingency(
  ctx: AuthContext,
): Promise<PortfolioRiskSummary> {
  const [projRes, runRes, poolRes, moveRes, alertRes] = await Promise.all([
    ctx.supabase.from("projects").select("id, name, code, company_id").limit(500),
    ctx.supabase
      .from("risk_sim_runs")
      .select("project_id, reporting_currency, results, approved_at, status")
      .eq("status", "approved")
      .limit(500),
    ctx.supabase
      .from("contingency_pools")
      .select("id, project_id, original_amount, is_management_reserve")
      .limit(2000),
    ctx.supabase
      .from("contingency_movements")
      .select("project_id, pool_id, kind, amount, status, effective_date")
      .eq("status", "approved")
      .limit(5000),
    ctx.supabase
      .from("risk_contingency_alerts")
      .select("*")
      .neq("status", "resolved")
      .order("severity", { ascending: true })
      .limit(300),
  ]);
  for (const r of [projRes, runRes, poolRes, moveRes, alertRes]) if (r.error) throw r.error;

  const projects = (projRes.data ?? []) as unknown as {
    id: string;
    name: string;
    code: string | null;
  }[];
  const runs = (runRes.data ?? []) as unknown as {
    project_id: string;
    reporting_currency: string;
    results: SimResult | null;
    approved_at: string | null;
  }[];
  const pools = (poolRes.data ?? []) as unknown as {
    id: string;
    project_id: string;
    original_amount: number | string;
    is_management_reserve: boolean;
  }[];
  const moves = (moveRes.data ?? []) as unknown as {
    project_id: string;
    pool_id: string;
    kind: string;
    amount: number | string;
    effective_date: string;
  }[];
  const alerts = (alertRes.data ?? []) as unknown as AlertRow[];
  const now = new Date();

  const rows: PortfolioRiskRow[] = [];
  for (const p of projects) {
    const run = runs.find((r) => r.project_id === p.id) ?? null;
    const projectPools = pools.filter((x) => x.project_id === p.id);
    if (!run && projectPools.length === 0) continue;
    const reserveIds = new Set(
      projectPools.filter((x) => x.is_management_reserve).map((x) => x.id),
    );
    const projMoves = moves.filter((m) => m.project_id === p.id && !reserveIds.has(m.pool_id));
    const sum = (kind: string) =>
      projMoves.filter((m) => m.kind === kind).reduce((s, m) => s + num(m.amount), 0);
    const rec = reconcileContingency({
      opening: projectPools
        .filter((x) => !x.is_management_reserve)
        .reduce((s, x) => s + num(x.original_amount), 0),
      additions: 0,
      transfers_in: sum("transfer_in"),
      transfers_out: sum("transfer_out"),
      drawdowns: sum("draw"),
      releases: sum("release"),
    });
    const reserve = projectPools
      .filter((x) => x.is_management_reserve)
      .reduce((s, x) => s + num(x.original_amount), 0);
    const res = run?.results ?? null;
    const adequacy = assessContingencyAdequacy({
      available: rec.closing,
      management_reserve: reserve,
      p50: res?.cost.p50 ?? 0,
      p80: res?.cost.p80 ?? 0,
      p90: res?.cost.p90 ?? 0,
    });
    const burn = burnRate(
      projMoves
        .filter((m) => m.kind === "draw")
        .map((m) => ({ effective_date: m.effective_date, amount: num(m.amount) })),
      now,
    );
    rows.push({
      project_id: p.id,
      project_name: p.name,
      project_code: p.code,
      reporting_currency: run?.reporting_currency ?? "USD",
      p50: res?.cost.p50 ?? 0,
      p80: res?.cost.p80 ?? 0,
      p90: res?.cost.p90 ?? 0,
      available: rec.closing,
      cover_p80: adequacy.cover_p80,
      shortfall: adequacy.shortfall_p80,
      band: adequacy.band,
      burn_per_day: burn.per_day,
      open_alerts: alerts.filter((a) => a.project_id === p.id).length,
      last_run_at: run?.approved_at ?? null,
      top_contributor: res?.tornado[0]?.title ?? null,
    });
  }

  rows.sort((a, b) => b.shortfall - a.shortfall || b.p80 - a.p80);

  return {
    rows,
    totals: {
      p80: rows.reduce((s, r) => s + r.p80, 0),
      available: rows.reduce((s, r) => s + r.available, 0),
      shortfall: rows.reduce((s, r) => s + r.shortfall, 0),
      projects: rows.length,
    },
    alerts,
  };
}
