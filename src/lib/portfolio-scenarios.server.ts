// GC-11 — Portfolio Scenario & Risk Forecasting: authorized persistence + compute.
//
// Everything money-related is delegated to the authoritative portfolio
// aggregation (`buildPortfolioCosting`). This module only stores overlays,
// enforces lifecycle rules and layers deltas on top of the approved basis.
// No approved forecast version, costing row or FX rate is ever written here.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasCloseRole } from "@/lib/costing.close.server";
import { costingAudit, costingHttpError } from "@/lib/costing.server";
import {
  buildPortfolioCosting,
  currentCompanyId,
  type PortfolioCostingData,
} from "@/lib/portfolio-costing.server";
import {
  buildScenarioCsv,
  buildScenarioProject,
  compareScenarios,
  consolidateScenario,
  isEditableStatus,
  SCENARIO_CONFIG_VERSION,
  type AssumptionSaveInput,
  type BridgeStep,
  type ComparisonLine,
  type Scenario,
  type ScenarioAssumption,
  type ScenarioCreateInput,
  type ScenarioListFilter,
  type ScenarioProjectResult,
  type ScenarioStatus,
  type ScenarioTotals,
  type ScenarioUpdateInput,
} from "@/lib/portfolio-scenarios.rules";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

const SCENARIO_TABLE = "portfolio_scenarios";
const ASSUMPTION_TABLE = "portfolio_scenario_assumptions";
const EVENT_TABLE = "portfolio_scenario_events";

const SCENARIO_COLS =
  "id, company_id, owner_id, name, purpose, notes, status, source_period, source_basis, " +
  "reporting_currency, fx_mode, fx_shock_pct, horizon_months, source_versions, config_version, " +
  "revision, copied_from_id, locked_at, archived_at, created_at, updated_at";

const ASSUMPTION_COLS =
  "id, scenario_id, project_id, cost_code_id, driver, period_month, label, amount, pct, " +
  "probability, delay_months, currency_code, source_table, source_id, note, sort_order";

interface RawScenario {
  id: string;
  company_id: string;
  owner_id: string;
  name: string;
  purpose: string | null;
  notes: string | null;
  status: ScenarioStatus;
  source_period: string;
  source_basis: "period_end" | "latest";
  reporting_currency: string;
  fx_mode: Scenario["fx_mode"];
  fx_shock_pct: number | string;
  horizon_months: number;
  source_versions: unknown;
  config_version: number;
  revision: number;
  copied_from_id: string | null;
  locked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function userId(ctx: AuthContext): string {
  const id = ctx.user?.id ?? null;
  if (!id) costingHttpError(401, "unauthorized", "Sign in to use portfolio scenarios.");
  return id as string;
}

async function requireFinance(ctx: AuthContext): Promise<void> {
  if (!(await hasCloseRole(ctx))) {
    costingHttpError(
      403,
      "forbidden",
      "Portfolio scenario forecasting is restricted to finance leadership.",
    );
  }
}

function toScenario(raw: RawScenario, uid: string, ownerName: string | null): Scenario {
  return {
    id: raw.id,
    company_id: raw.company_id,
    owner_id: raw.owner_id,
    owner_name: ownerName,
    is_owner: raw.owner_id === uid,
    name: raw.name,
    purpose: raw.purpose,
    notes: raw.notes,
    status: raw.status,
    source_period: String(raw.source_period).slice(0, 10),
    source_basis: raw.source_basis,
    reporting_currency: raw.reporting_currency,
    fx_mode: raw.fx_mode,
    fx_shock_pct: Number(raw.fx_shock_pct ?? 0),
    horizon_months: raw.horizon_months,
    source_versions: Array.isArray(raw.source_versions)
      ? (raw.source_versions as Scenario["source_versions"])
      : [],
    config_version: raw.config_version,
    revision: raw.revision,
    copied_from_id: raw.copied_from_id,
    locked_at: raw.locked_at,
    archived_at: raw.archived_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

function toAssumption(raw: Record<string, unknown>): ScenarioAssumption {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(raw["id"]),
    scenario_id: String(raw["scenario_id"]),
    project_id: (raw["project_id"] as string | null) ?? null,
    cost_code_id: (raw["cost_code_id"] as string | null) ?? null,
    driver: raw["driver"] as ScenarioAssumption["driver"],
    period_month: raw["period_month"] ? String(raw["period_month"]).slice(0, 10) : null,
    label: (raw["label"] as string | null) ?? null,
    amount: num(raw["amount"]),
    pct: num(raw["pct"]),
    probability: num(raw["probability"]),
    delay_months: num(raw["delay_months"]),
    currency_code: (raw["currency_code"] as string | null) ?? null,
    source_table: (raw["source_table"] as string | null) ?? null,
    source_id: (raw["source_id"] as string | null) ?? null,
    note: (raw["note"] as string | null) ?? null,
    sort_order: Number(raw["sort_order"] ?? 0),
  };
}

async function logEvent(
  ctx: AuthContext,
  scenario: { id: string; company_id: string },
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await sbOf(ctx)
    .from(EVENT_TABLE)
    .insert({
      scenario_id: scenario.id,
      company_id: scenario.company_id,
      action,
      actor_id: ctx.user?.id ?? null,
      detail,
    });
  await costingAudit(ctx, `costing.portfolio.scenario_${action}`, SCENARIO_TABLE, scenario.id, {
    company_id: scenario.company_id,
    scenario_id: scenario.id,
    ...detail,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listScenarios(
  ctx: AuthContext,
  filter: ScenarioListFilter,
): Promise<Scenario[]> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);

  let q = sbOf(ctx)
    .from(SCENARIO_TABLE)
    .select(SCENARIO_COLS)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });
  if (filter.status !== "all") q = q.eq("status", filter.status);
  if (filter.mine) q = q.eq("owner_id", uid);

  const [{ data, error }, profiles] = await Promise.all([
    q,
    sbOf(ctx).from("profiles").select("id, full_name").eq("company_id", companyId),
  ]);
  if (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  const names = new Map(
    ((profiles.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name ?? null,
    ]),
  );
  return ((data ?? []) as RawScenario[]).map((r) =>
    toScenario(r, uid, names.get(r.owner_id) ?? null),
  );
}

async function loadScenarioRow(ctx: AuthContext, id: string): Promise<RawScenario> {
  const { data, error } = await sbOf(ctx)
    .from(SCENARIO_TABLE)
    .select(SCENARIO_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? null) as RawScenario | null;
  if (!row) costingHttpError(404, "scenario_not_found", "Scenario not found.");
  return row!;
}

async function loadAssumptions(
  ctx: AuthContext,
  scenarioId: string,
): Promise<ScenarioAssumption[]> {
  const { data, error } = await sbOf(ctx)
    .from(ASSUMPTION_TABLE)
    .select(ASSUMPTION_COLS)
    .eq("scenario_id", scenarioId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toAssumption);
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------
export interface ScenarioResultPayload {
  scenario: Scenario;
  assumptions: ScenarioAssumption[];
  results: ScenarioProjectResult[];
  totals: ScenarioTotals;
  bridge: BridgeStep[];
  base: {
    period: string;
    reporting_currency: string;
    basis: string;
    official: boolean;
    rate_date: string;
  };
  history: { action: string; actor_id: string | null; summary: string; created_at: string }[];
  comparison: { scenario: Scenario; lines: ComparisonLine[]; delta_total: number } | null;
}

async function computeFor(
  ctx: AuthContext,
  companyId: string,
  scenario: Scenario,
  assumptions: readonly ScenarioAssumption[],
): Promise<{ results: ScenarioProjectResult[]; base: PortfolioCostingData }> {
  // FX mode "current" simply re-anchors the *rates* to today via the existing
  // consolidation basis; it never re-rates the frozen snapshot amounts.
  const base = await buildPortfolioCosting(ctx, companyId, {
    period: scenario.source_period,
    currency: scenario.reporting_currency,
    basis: scenario.fx_mode === "current" ? "latest" : scenario.source_basis,
  });
  const results = base.rows.map((row) =>
    buildScenarioProject(row, assumptions, {
      reportingCurrency: base.reporting_currency,
      fxMode: scenario.fx_mode,
      fxShockPct: scenario.fx_shock_pct,
    }),
  );
  return { results, base };
}

export async function loadScenario(
  ctx: AuthContext,
  id: string,
  compareTo: string | null,
): Promise<ScenarioResultPayload> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const raw = await loadScenarioRow(ctx, id);
  const scenario = toScenario(raw, uid, null);
  const assumptions = await loadAssumptions(ctx, id);
  const { results, base } = await computeFor(ctx, companyId, scenario, assumptions);
  const { totals, bridge } = consolidateScenario(results);

  const { data: events } = await sbOf(ctx)
    .from(EVENT_TABLE)
    .select("action, actor_id, detail, created_at")
    .eq("scenario_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  let comparison: ScenarioResultPayload["comparison"] = null;
  if (compareTo && compareTo !== id) {
    const otherRaw = await loadScenarioRow(ctx, compareTo);
    const other = toScenario(otherRaw, uid, null);
    const otherAssumptions = await loadAssumptions(ctx, compareTo);
    const otherComputed = await computeFor(ctx, companyId, other, otherAssumptions);
    const cmp = compareScenarios(results, otherComputed.results);
    comparison = { scenario: other, lines: cmp.lines, delta_total: cmp.delta_total };
  }

  return {
    scenario,
    assumptions,
    results,
    totals,
    bridge,
    base: {
      period: base.period,
      reporting_currency: base.reporting_currency,
      basis: base.basis,
      official: base.gate.official,
      rate_date: base.rate_date,
    },
    history: (
      (events ?? []) as {
        action: string;
        actor_id: string | null;
        detail: unknown;
        created_at: string;
      }[]
    ).map((e) => ({
      action: e.action,
      actor_id: e.actor_id,
      created_at: e.created_at,
      summary: JSON.stringify(e.detail ?? {}),
    })),
    comparison,
  };
}

export async function exportScenarioCsv(
  ctx: AuthContext,
  id: string,
): Promise<{ filename: string; csv: string }> {
  const payload = await loadScenario(ctx, id, null);
  const slug = payload.scenario.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  await logEvent(
    ctx,
    { id: payload.scenario.id, company_id: payload.scenario.company_id },
    "exported",
    { period: payload.scenario.source_period, currency: payload.scenario.reporting_currency },
  );
  return {
    filename: `scenario-${slug || "portfolio"}-${payload.scenario.source_period.slice(0, 7)}.csv`,
    csv: buildScenarioCsv(payload.scenario, payload.results, payload.totals),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createScenario(
  ctx: AuthContext,
  input: ScenarioCreateInput,
): Promise<Scenario> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);

  // Anchor to the authoritative consolidation so the scenario records exactly
  // which approved versions it was built on.
  const base = await buildPortfolioCosting(ctx, companyId, {
    ...(input.source_period ? { period: input.source_period } : {}),
    ...(input.reporting_currency ? { currency: input.reporting_currency } : {}),
    basis: input.source_basis,
  });
  const sourceVersions = base.rows.map((r) => ({
    project_id: r.project_id,
    version_id: r.version?.id ?? null,
    version_no: r.version?.version_no ?? null,
  }));

  const { data, error } = await sbOf(ctx)
    .from(SCENARIO_TABLE)
    .insert({
      company_id: companyId,
      owner_id: uid,
      name: input.name,
      purpose: input.purpose,
      notes: input.notes,
      source_period: base.period,
      source_basis: input.source_basis,
      reporting_currency: base.reporting_currency,
      fx_mode: input.fx_mode,
      fx_shock_pct: input.fx_shock_pct,
      horizon_months: input.horizon_months,
      source_versions: sourceVersions,
      config_version: SCENARIO_CONFIG_VERSION,
    })
    .select(SCENARIO_COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      costingHttpError(409, "scenario_name_taken", "You already have a scenario with that name.");
    }
    throw error;
  }
  const row = data as RawScenario;
  await logEvent(ctx, row, "created", {
    name: row.name,
    period: base.period,
    currency: base.reporting_currency,
    fx_mode: row.fx_mode,
    projects: sourceVersions.length,
  });
  return toScenario(row, uid, null);
}

function assertEditable(raw: RawScenario, uid: string): void {
  if (!isEditableStatus(raw.status)) {
    costingHttpError(
      409,
      "scenario_not_editable",
      `A ${raw.status} scenario is read-only. Duplicate it to keep exploring.`,
    );
  }
  if (raw.owner_id !== uid) {
    costingHttpError(403, "not_scenario_owner", "Only the owner can edit this scenario.");
  }
}

export async function updateScenario(
  ctx: AuthContext,
  input: ScenarioUpdateInput,
): Promise<Scenario> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const raw = await loadScenarioRow(ctx, input.id);
  assertEditable(raw, uid);
  if (input.revision !== undefined && input.revision !== raw.revision) {
    costingHttpError(
      409,
      "scenario_stale",
      "This scenario changed in another tab. Reload before saving.",
    );
  }

  const patch: Record<string, unknown> = { revision: raw.revision + 1 };
  for (const key of [
    "name",
    "purpose",
    "notes",
    "fx_mode",
    "fx_shock_pct",
    "horizon_months",
    "reporting_currency",
    "source_basis",
  ] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }

  const { data, error } = await sbOf(ctx)
    .from(SCENARIO_TABLE)
    .update(patch)
    .eq("id", input.id)
    .eq("revision", raw.revision)
    .select(SCENARIO_COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      costingHttpError(409, "scenario_name_taken", "You already have a scenario with that name.");
    }
    throw error;
  }
  const row = data as RawScenario;
  await logEvent(ctx, row, "updated", {
    before: { name: raw.name, fx_mode: raw.fx_mode, fx_shock_pct: Number(raw.fx_shock_pct) },
    after: { name: row.name, fx_mode: row.fx_mode, fx_shock_pct: Number(row.fx_shock_pct) },
  });
  return toScenario(row, uid, null);
}

const NEXT_STATUS: Record<string, ScenarioStatus> = {
  share: "shared",
  unshare: "draft",
  lock: "locked",
  archive: "archived",
};

export async function transitionScenario(
  ctx: AuthContext,
  id: string,
  action: "share" | "unshare" | "lock" | "archive",
): Promise<Scenario> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const raw = await loadScenarioRow(ctx, id);
  const next = NEXT_STATUS[action]!;

  if (raw.status === "archived") {
    costingHttpError(409, "scenario_archived", "Archived scenarios cannot change state.");
  }
  if (raw.status === "locked" && next !== "archived") {
    costingHttpError(409, "scenario_locked", "A locked scenario can only be archived.");
  }
  if (action === "unshare" && raw.status !== "shared") {
    costingHttpError(409, "scenario_not_shared", "This scenario is not shared.");
  }
  if (raw.owner_id !== uid && action !== "archive") {
    costingHttpError(403, "not_scenario_owner", "Only the owner can change sharing or lock it.");
  }

  const { data, error } = await sbOf(ctx)
    .from(SCENARIO_TABLE)
    .update({ status: next, revision: raw.revision + 1 })
    .eq("id", id)
    .eq("revision", raw.revision)
    .select(SCENARIO_COLS)
    .single();
  if (error) throw error;
  const row = data as RawScenario;
  await logEvent(ctx, row, action === "unshare" ? "unshared" : `${action}ed`, {
    from: raw.status,
    to: row.status,
  });
  return toScenario(row, uid, null);
}

export async function duplicateScenario(
  ctx: AuthContext,
  id: string,
  name: string,
): Promise<Scenario> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const raw = await loadScenarioRow(ctx, id);
  const assumptions = await loadAssumptions(ctx, id);

  const { data, error } = await sbOf(ctx)
    .from(SCENARIO_TABLE)
    .insert({
      company_id: companyId,
      owner_id: uid,
      name,
      purpose: raw.purpose,
      notes: raw.notes,
      source_period: raw.source_period,
      source_basis: raw.source_basis,
      reporting_currency: raw.reporting_currency,
      fx_mode: raw.fx_mode,
      fx_shock_pct: raw.fx_shock_pct,
      horizon_months: raw.horizon_months,
      source_versions: raw.source_versions,
      config_version: SCENARIO_CONFIG_VERSION,
      copied_from_id: raw.id,
    })
    .select(SCENARIO_COLS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      costingHttpError(409, "scenario_name_taken", "You already have a scenario with that name.");
    }
    throw error;
  }
  const row = data as RawScenario;

  if (assumptions.length) {
    const { error: copyError } = await sbOf(ctx)
      .from(ASSUMPTION_TABLE)
      .insert(
        assumptions.map((a) => ({
          scenario_id: row.id,
          company_id: companyId,
          project_id: a.project_id,
          cost_code_id: a.cost_code_id,
          driver: a.driver,
          period_month: a.period_month,
          label: a.label,
          amount: a.amount,
          pct: a.pct,
          probability: a.probability,
          delay_months: a.delay_months,
          currency_code: a.currency_code,
          source_table: a.source_table,
          source_id: a.source_id,
          note: a.note,
          sort_order: a.sort_order,
        })),
      );
    if (copyError) throw copyError;
  }
  await logEvent(ctx, row, "copied", { from: raw.id, assumptions: assumptions.length });
  return toScenario(row, uid, null);
}

export async function deleteScenario(ctx: AuthContext, id: string): Promise<{ id: string }> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const raw = await loadScenarioRow(ctx, id);
  assertEditable(raw, uid);
  await costingAudit(ctx, "costing.portfolio.scenario_deleted", SCENARIO_TABLE, id, {
    company_id: raw.company_id,
    scenario_id: id,
    name: raw.name,
  });
  const { error } = await sbOf(ctx).from(SCENARIO_TABLE).delete().eq("id", id);
  if (error) throw error;
  return { id };
}

export async function saveAssumption(
  ctx: AuthContext,
  input: AssumptionSaveInput,
): Promise<ScenarioAssumption> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const companyId = await currentCompanyId(ctx);
  const raw = await loadScenarioRow(ctx, input.scenario_id);
  assertEditable(raw, uid);

  const payload = {
    scenario_id: input.scenario_id,
    company_id: companyId,
    project_id: input.project_id,
    cost_code_id: input.cost_code_id,
    driver: input.driver,
    period_month: input.period_month,
    label: input.label,
    amount: input.amount,
    pct: input.pct,
    probability: input.probability,
    delay_months: input.delay_months,
    currency_code: input.currency_code,
    source_table: input.source_table,
    source_id: input.source_id,
    note: input.note,
    sort_order: input.sort_order,
  };

  const query = input.id
    ? sbOf(ctx)
        .from(ASSUMPTION_TABLE)
        .update(payload)
        .eq("id", input.id)
        .eq("scenario_id", input.scenario_id)
    : sbOf(ctx).from(ASSUMPTION_TABLE).insert(payload);
  const { data, error } = await query.select(ASSUMPTION_COLS).single();
  if (error) throw error;

  await logEvent(ctx, raw, input.id ? "assumption_updated" : "assumption_added", {
    driver: input.driver,
    project_id: input.project_id,
    amount: input.amount,
    pct: input.pct,
    probability: input.probability,
  });
  return toAssumption(data as Record<string, unknown>);
}

export async function deleteAssumption(
  ctx: AuthContext,
  id: string,
  scenarioId: string,
): Promise<{ id: string }> {
  await requireFinance(ctx);
  const uid = userId(ctx);
  const raw = await loadScenarioRow(ctx, scenarioId);
  assertEditable(raw, uid);
  const { error } = await sbOf(ctx)
    .from(ASSUMPTION_TABLE)
    .delete()
    .eq("id", id)
    .eq("scenario_id", scenarioId);
  if (error) throw error;
  await logEvent(ctx, raw, "assumption_removed", { assumption_id: id });
  return { id };
}
