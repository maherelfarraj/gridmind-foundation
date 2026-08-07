// GC-12 — Integrated EVM: authorized persistence and authoritative compute.
//
// This module NEVER recomputes cost. Budget, actual, accrual and bottom-up ETC
// all come from `loadCostingWorkspace` (the costing module's single source of
// truth, already in project currency). EVM adds only the schedule/progress
// dimension on top and freezes the result into its own snapshot.
//
// Reads are set-based: a fixed number of queries per project regardless of how
// many WBS items, tasks or mappings exist.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveFx, sumMoney, toMinor } from "@/lib/costing.fx";
import { currentReportingPeriod, mostRestrictiveState } from "@/lib/costing.periods";
import {
  COSTING_WRITE_ROLES,
  costingAudit,
  costingHttpError,
  hasAnyCostingRole,
  loadCostingProject,
  loadCostingWorkspace,
} from "@/lib/costing.server";
import {
  alertFingerprint,
  analyseTrend,
  applyOverride,
  assessQuality,
  buildDetailCsv,
  buildExceptionCsv,
  buildFormulaComparisonCsv,
  buildMappingCsv,
  buildTrendCsv,
  calculateProgress,
  checkTransition,
  computeMeasures,
  consolidateEvm,
  eacMethodDistribution,
  earnedDelayDays,
  EVM_GATE_BLOCKED,
  EVM_VERSION_CONFLICT,
  performanceExceptions,
  periodEndOf,
  plannedPercent,
  plannedValue,
  quadrantOf,
  reconcile,
  rollUp,
  sumCores,
  supersedePlan,
  topAdverseMovers,
  translateMeasures,
  type AcBasis,
  type EacMethod,
  type EvmAppendix,
  type EvmCore,
  type EvmException,
  type EvmFx,
  type EvmMeasures,
  type EvmNode,
  type GatePolicy,
  type MappingRow,
  type PerformancePolicy,
  type PortfolioEvmFilter,
  type PortfolioEvmRow,
  type ProgressMethod,
  type ReportStatus,
  type TrendPoint,
} from "@/lib/evm.report.rules";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return (data ?? []) as T[];
}

async function one<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
  return (data ?? null) as T | null;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
export async function requireEvmWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyCostingRole(ctx, COSTING_WRITE_ROLES))) {
    costingHttpError(403, "forbidden", "Project controls or finance role required.");
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export interface EvmSettings extends PerformancePolicy, GatePolicy {
  project_id: string;
  default_progress_method: ProgressMethod;
  official_eac_method: EacMethod;
  include_accruals_in_ac: boolean;
  progress_stale_days: number;
}

const DEFAULT_SETTINGS: Omit<EvmSettings, "project_id"> = {
  default_progress_method: "physical_pct",
  official_eac_method: "bottom_up",
  include_accruals_in_ac: true,
  cpi_threshold: 0.95,
  spi_threshold: 0.95,
  variance_threshold_pct: 5,
  variance_threshold_amount: 100_000,
  tcpi_feasibility_limit: 1.1,
  gate_block_on_unmapped: true,
  gate_max_unmapped_pct: 5,
  gate_block_on_stale_progress: true,
  progress_stale_days: 45,
};

export async function loadEvmSettings(ctx: AuthContext, projectId: string): Promise<EvmSettings> {
  const row = await one<Record<string, unknown>>(
    sbOf(ctx).from("evm_settings").select("*").eq("project_id", projectId).maybeSingle(),
  );
  if (!row) return { project_id: projectId, ...DEFAULT_SETTINGS };
  const num = (k: string, fallback: number) =>
    row[k] === null || row[k] === undefined ? fallback : Number(row[k]);
  return {
    project_id: projectId,
    default_progress_method: (row["default_progress_method"] ??
      DEFAULT_SETTINGS.default_progress_method) as ProgressMethod,
    official_eac_method: (row["official_eac_method"] ??
      DEFAULT_SETTINGS.official_eac_method) as EacMethod,
    include_accruals_in_ac: row["include_accruals_in_ac"] !== false,
    cpi_threshold: num("cpi_threshold", DEFAULT_SETTINGS.cpi_threshold),
    spi_threshold: num("spi_threshold", DEFAULT_SETTINGS.spi_threshold),
    variance_threshold_pct: num("variance_threshold_pct", DEFAULT_SETTINGS.variance_threshold_pct),
    variance_threshold_amount: num(
      "variance_threshold_amount",
      DEFAULT_SETTINGS.variance_threshold_amount,
    ),
    tcpi_feasibility_limit: num("tcpi_feasibility_limit", DEFAULT_SETTINGS.tcpi_feasibility_limit),
    gate_block_on_unmapped: row["gate_block_on_unmapped"] !== false,
    gate_max_unmapped_pct: num("gate_max_unmapped_pct", DEFAULT_SETTINGS.gate_max_unmapped_pct),
    gate_block_on_stale_progress: row["gate_block_on_stale_progress"] !== false,
    progress_stale_days: num("progress_stale_days", DEFAULT_SETTINGS.progress_stale_days),
  };
}

export async function saveEvmSettings(
  ctx: AuthContext,
  input: Record<string, unknown> & { project_id: string; reason?: string },
): Promise<EvmSettings> {
  await requireEvmWrite(ctx);
  const project = await loadCostingProject(ctx, input.project_id);
  const { reason: _reason, ...patch } = input;
  const { error } = await sbOf(ctx)
    .from("evm_settings")
    .upsert(
      { ...patch, company_id: project.company_id, updated_by: ctx.user?.id ?? null },
      { onConflict: "project_id" },
    );
  if (error) throw error;
  await costingAudit(ctx, "evm.settings.updated", "evm_settings", input.project_id, {
    project_id: input.project_id,
    reason: input.reason ?? null,
    fields: Object.keys(patch).filter((k) => k !== "project_id"),
  });
  return loadEvmSettings(ctx, input.project_id);
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------
export interface MappingVersionRow {
  id: string;
  project_id: string;
  version_no: number;
  status: "draft" | "approved" | "superseded";
  label: string | null;
  row_version: number;
  approved_at: string | null;
}

export async function listMappingVersions(
  ctx: AuthContext,
  projectId: string,
): Promise<MappingVersionRow[]> {
  return rows<MappingVersionRow>(
    sbOf(ctx)
      .from("evm_mapping_versions")
      .select("id, project_id, version_no, status, label, row_version, approved_at")
      .eq("project_id", projectId)
      .order("version_no", { ascending: false }),
  );
}

async function activeMappingVersion(
  ctx: AuthContext,
  projectId: string,
): Promise<MappingVersionRow | null> {
  const versions = await listMappingVersions(ctx, projectId);
  return versions.find((v) => v.status === "approved") ?? versions.find((v) => v.status === "draft") ?? null;
}

export async function listMappings(
  ctx: AuthContext,
  versionId: string,
): Promise<(MappingRow & { mapping_version_id: string })[]> {
  const raw = await rows<Record<string, unknown>>(
    sbOf(ctx)
      .from("evm_mappings")
      .select(
        "id, mapping_version_id, wbs_item_id, schedule_task_id, cost_code_id, allocation_pct, progress_method, milestone_weights, planned_units",
      )
      .eq("mapping_version_id", versionId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
  );
  return raw.map((r) => ({
    id: String(r["id"]),
    mapping_version_id: String(r["mapping_version_id"]),
    wbs_item_id: (r["wbs_item_id"] as string | null) ?? null,
    schedule_task_id: (r["schedule_task_id"] as string | null) ?? null,
    cost_code_id: (r["cost_code_id"] as string | null) ?? null,
    allocation_pct: Number(r["allocation_pct"] ?? 0),
    progress_method: (r["progress_method"] ?? "physical_pct") as ProgressMethod,
    milestone_weights: (r["milestone_weights"] as MappingRow["milestone_weights"]) ?? null,
    planned_units: r["planned_units"] === null ? null : Number(r["planned_units"]),
  }));
}

export async function createMappingVersion(
  ctx: AuthContext,
  projectId: string,
  label?: string | null,
): Promise<string> {
  await requireEvmWrite(ctx);
  const project = await loadCostingProject(ctx, projectId);
  const existing = await listMappingVersions(ctx, projectId);
  const nextNo = (existing[0]?.version_no ?? 0) + 1;
  const inserted = await one<{ id: string }>(
    sbOf(ctx)
      .from("evm_mapping_versions")
      .insert({
        company_id: project.company_id,
        project_id: projectId,
        version_no: nextNo,
        status: "draft",
        label: label ?? null,
        created_by: ctx.user?.id ?? null,
      })
      .select("id")
      .single(),
  );
  if (!inserted) costingHttpError(500, "evm_mapping_version_failed");
  await costingAudit(ctx, "evm.mapping_version.created", "evm_mapping_versions", inserted!.id, {
    project_id: projectId,
    version_no: nextNo,
  });
  return inserted!.id;
}

export async function approveMappingVersion(ctx: AuthContext, versionId: string): Promise<void> {
  await requireEvmWrite(ctx);
  const version = await one<MappingVersionRow & { company_id: string }>(
    sbOf(ctx).from("evm_mapping_versions").select("*").eq("id", versionId).maybeSingle(),
  );
  if (!version) costingHttpError(404, "evm_mapping_version_not_found");
  if (version!.status !== "draft") costingHttpError(409, "evm_invalid_transition");

  const mappings = await listMappings(ctx, versionId);
  const { reconcileAllocations } = await import("@/lib/evm.report.rules");
  const issues = reconcileAllocations(mappings).filter((a) => !a.ok);
  if (issues.length > 0) {
    costingHttpError(422, "evm_allocation_unreconciled", `${issues.length} scope item(s) do not total 100%.`);
  }

  const prior = (await listMappingVersions(ctx, version!.project_id)).filter(
    (v) => v.status === "approved",
  );
  const { error } = await sbOf(ctx)
    .from("evm_mapping_versions")
    .update({
      status: "approved",
      approved_by: ctx.user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", versionId);
  if (error) throw error;
  for (const p of prior) {
    await sbOf(ctx)
      .from("evm_mapping_versions")
      .update({ status: "superseded", superseded_by_id: versionId })
      .eq("id", p.id);
  }
  await costingAudit(ctx, "evm.mapping_version.approved", "evm_mapping_versions", versionId, {
    project_id: version!.project_id,
    superseded: prior.map((p) => p.id),
  });
}

export async function saveMapping(
  ctx: AuthContext,
  input: Record<string, unknown> & { mapping_version_id: string },
): Promise<string> {
  await requireEvmWrite(ctx);
  const version = await one<{ id: string; project_id: string; company_id: string; status: string }>(
    sbOf(ctx)
      .from("evm_mapping_versions")
      .select("id, project_id, company_id, status")
      .eq("id", input.mapping_version_id)
      .maybeSingle(),
  );
  if (!version) costingHttpError(404, "evm_mapping_version_not_found");
  if (version!.status !== "draft") costingHttpError(409, "evm_mapping_version_frozen");

  const payload = {
    ...input,
    company_id: version!.company_id,
    project_id: version!.project_id,
    created_by: ctx.user?.id ?? null,
  };
  const saved = await one<{ id: string }>(
    input["id"]
      ? sbOf(ctx).from("evm_mappings").update(payload).eq("id", input["id"]).select("id").single()
      : sbOf(ctx).from("evm_mappings").insert(payload).select("id").single(),
  );
  if (!saved) costingHttpError(500, "evm_mapping_save_failed");
  await costingAudit(ctx, "evm.mapping.saved", "evm_mappings", saved!.id, {
    project_id: version!.project_id,
    mapping_version_id: version!.id,
  });
  return saved!.id;
}

export async function deleteMapping(ctx: AuthContext, mappingId: string): Promise<void> {
  await requireEvmWrite(ctx);
  const { error } = await sbOf(ctx).from("evm_mappings").delete().eq("id", mappingId);
  if (error) throw error;
  await costingAudit(ctx, "evm.mapping.deleted", "evm_mappings", mappingId, {});
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
export interface OverrideRow {
  id: string;
  wbs_item_id: string | null;
  schedule_task_id: string | null;
  calculated_pct: number | null;
  override_pct: number;
  reason: string;
  evidence_ref: string;
  approved_by: string | null;
}

async function loadOverrides(
  ctx: AuthContext,
  projectId: string,
  period: string,
): Promise<Map<string, OverrideRow>> {
  const raw = await rows<Record<string, unknown>>(
    sbOf(ctx)
      .from("evm_progress_overrides")
      .select(
        "id, wbs_item_id, schedule_task_id, calculated_pct, override_pct, reason, evidence_ref, approved_by",
      )
      .eq("project_id", projectId)
      .eq("period_month", period),
  );
  const map = new Map<string, OverrideRow>();
  for (const r of raw) {
    const row: OverrideRow = {
      id: String(r["id"]),
      wbs_item_id: (r["wbs_item_id"] as string | null) ?? null,
      schedule_task_id: (r["schedule_task_id"] as string | null) ?? null,
      calculated_pct: r["calculated_pct"] === null ? null : Number(r["calculated_pct"]),
      override_pct: Number(r["override_pct"]),
      reason: String(r["reason"] ?? ""),
      evidence_ref: String(r["evidence_ref"] ?? ""),
      approved_by: (r["approved_by"] as string | null) ?? null,
    };
    map.set(row.schedule_task_id ? `task:${row.schedule_task_id}` : `wbs:${row.wbs_item_id}`, row);
  }
  return map;
}

export async function saveProgressOverride(
  ctx: AuthContext,
  input: Record<string, unknown> & { project_id: string; period: string },
): Promise<string> {
  await requireEvmWrite(ctx);
  const project = await loadCostingProject(ctx, input.project_id);
  await assertPeriodOpenForEvm(ctx, input.project_id, input.period);
  const { period, ...rest } = input;
  const saved = await one<{ id: string }>(
    sbOf(ctx)
      .from("evm_progress_overrides")
      .upsert(
        {
          ...rest,
          period_month: period,
          company_id: project.company_id,
          approved_by: ctx.user?.id ?? null,
          approved_at: new Date().toISOString(),
          created_by: ctx.user?.id ?? null,
        },
        { onConflict: "project_id,period_month,wbs_item_id,schedule_task_id" },
      )
      .select("id")
      .single(),
  );
  await costingAudit(ctx, "evm.progress.overridden", "evm_progress_overrides", saved?.id ?? null, {
    project_id: input.project_id,
    period_month: period,
    override_pct: input["override_pct"],
    // Reason and evidence are recorded on the row itself; the audit trail
    // carries only their presence so free text is not duplicated into logs.
    has_reason: true,
    has_evidence: true,
  });
  return saved?.id ?? "";
}

export async function deleteProgressOverride(ctx: AuthContext, overrideId: string): Promise<void> {
  await requireEvmWrite(ctx);
  const { error } = await sbOf(ctx).from("evm_progress_overrides").delete().eq("id", overrideId);
  if (error) throw error;
  await costingAudit(ctx, "evm.progress.override_removed", "evm_progress_overrides", overrideId, {});
}

// ---------------------------------------------------------------------------
// Period locks
// ---------------------------------------------------------------------------
async function periodState(ctx: AuthContext, projectId: string, period: string) {
  const raw = await rows<{ project_id: string | null; state: string }>(
    sbOf(ctx)
      .from("costing_periods")
      .select("project_id, state")
      .eq("period_month", period)
      .or(`project_id.eq.${projectId},project_id.is.null`),
  );
  return mostRestrictiveState(...(raw.map((r) => r.state) as never[]));
}

async function assertPeriodOpenForEvm(ctx: AuthContext, projectId: string, period: string) {
  const state = await periodState(ctx, projectId, period);
  if (state === "hard_closed") {
    costingHttpError(409, "costing_period_hard_closed", "The reporting period is closed.");
  }
}

// ---------------------------------------------------------------------------
// Authoritative compute
// ---------------------------------------------------------------------------
export interface EvmComputed {
  project: { id: string; code: string; name: string };
  period_month: string;
  data_date: string;
  project_currency: string;
  reporting_currency: string;
  fx: EvmFx;
  ac_basis: AcBasis;
  eac_method: EacMethod;
  cost_basis: string;
  mapping_version_id: string | null;
  schedule_baseline_id: string | null;
  nodes: EvmNode[];
  total: EvmMeasures;
  total_reporting: EvmMeasures | null;
  delay_days: number | null;
  quality: ReturnType<typeof assessQuality>;
  performance: EvmException[];
  reconciliation: ReturnType<typeof reconcile>;
  settings: EvmSettings;
}

interface WbsRow {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  planned_quantity: number | null;
}

interface TaskRow {
  id: string;
  wbs_item_id: string | null;
  name: string;
  start_date: string | null;
  end_date: string | null;
  progress_pct: number | null;
  status: string | null;
  is_milestone: boolean | null;
  updated_at: string | null;
}

/**
 * Build the working EVM calculation for a period. Pure read: nothing is
 * written and no approved artefact is touched.
 */
export async function computeEvm(
  ctx: AuthContext,
  input: {
    project_id: string;
    period?: string;
    currency?: string;
    ac_basis?: AcBasis;
    eac_method?: EacMethod;
    data_date?: string;
    schedule_baseline_id?: string | null;
  },
): Promise<EvmComputed> {
  const project = await loadCostingProject(ctx, input.project_id);
  const period = input.period ?? currentReportingPeriod();
  const data_date = input.data_date ?? periodEndOf(period);
  const settings = await loadEvmSettings(ctx, input.project_id);
  const eac_method = input.eac_method ?? settings.official_eac_method;
  const ac_basis: AcBasis =
    input.ac_basis ?? (settings.include_accruals_in_ac ? "actual_plus_accrual" : "actual_only");

  const version = await activeMappingVersion(ctx, input.project_id);
  const [workspace, wbs, tasks, mappings, overrides] = await Promise.all([
    loadCostingWorkspace(ctx, input.project_id),
    rows<WbsRow>(
      sbOf(ctx)
        .from("wbs_items")
        .select("id, parent_id, code, name, planned_quantity")
        .eq("project_id", input.project_id)
        .order("code", { ascending: true }),
    ),
    rows<TaskRow>(
      sbOf(ctx)
        .from("schedule_tasks")
        .select(
          "id, wbs_item_id, name, start_date, end_date, progress_pct, status, is_milestone, updated_at",
        )
        .eq("project_id", input.project_id),
    ),
    version ? listMappings(ctx, version.id) : Promise.resolve([]),
    loadOverrides(ctx, input.project_id, period),
  ]);

  const project_currency = workspace.baseCurrency;
  const reporting_currency = (input.currency ?? project_currency).toUpperCase();
  const fx = await resolveEvmFx(ctx, project_currency, reporting_currency, data_date);

  // --- authoritative cost per cost code (already in project currency) ------
  const cbsById = new Map(workspace.cbs.map((r) => [r.id, r]));
  const costOf = (codeId: string | null) => {
    const row = codeId ? cbsById.get(codeId) : undefined;
    if (!row) return { bac: 0, actual: 0, accruals: 0, etc: 0 };
    return { bac: row.current, actual: row.actual, accruals: row.accruals, etc: row.etc };
  };

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const wbsById = new Map(wbs.map((w) => [w.id, w]));

  // --- leaves: one node per mapping ----------------------------------------
  const leaves: EvmNode[] = [];
  let missing_baseline_dates = 0;
  let missing_budget = 0;
  let stale_progress = 0;
  let future_dated_progress = 0;
  let missing_actuals = 0;
  const mappedCostCodes = new Set<string>();

  for (const m of mappings) {
    const task = m.schedule_task_id ? tasksById.get(m.schedule_task_id) : undefined;
    const wbsItem = m.wbs_item_id ? wbsById.get(m.wbs_item_id) : undefined;
    const label = task?.name ?? (wbsItem ? `${wbsItem.code} ${wbsItem.name}` : "Unmapped");
    const share = (m.allocation_pct ?? 0) / 100;
    const cost = costOf(m.cost_code_id);
    if (m.cost_code_id) mappedCostCodes.add(m.cost_code_id);

    const bac = sumMoney([cost.bac * share]);
    const ac = sumMoney(
      ac_basis === "actual_plus_accrual"
        ? [cost.actual * share, cost.accruals * share]
        : [cost.actual * share],
    );
    const bottom_up_etc = sumMoney([cost.etc * share]);

    const baseline_start = task?.start_date ?? null;
    const baseline_finish = task?.end_date ?? null;
    if (!baseline_start || !baseline_finish) missing_baseline_dates += 1;
    if (toMinor(bac) === 0) missing_budget += 1;
    if (toMinor(ac) === 0 && toMinor(bac) > 0) missing_actuals += 1;

    const planned_pct = plannedPercent({
      bac,
      baseline_start,
      baseline_finish,
      data_date,
      is_milestone: Boolean(task?.is_milestone),
    });

    const complete = (task?.progress_pct ?? 0) >= 100 || task?.status === "completed";
    const started = (task?.progress_pct ?? 0) > 0 || task?.status === "in_progress";
    const progress = calculateProgress({
      method: m.progress_method,
      physical_pct: task?.progress_pct ?? null,
      milestones: m.milestone_weights ?? null,
      units_complete: null,
      planned_units: m.planned_units ?? wbsItem?.planned_quantity ?? null,
      started,
      complete,
      planned_pct,
    });

    // Progress reported after the data date must not earn value in this period.
    const reportedAt = task?.updated_at ? task.updated_at.slice(0, 10) : null;
    if (reportedAt && reportedAt > data_date) future_dated_progress += 1;
    if (reportedAt && settings.gate_block_on_stale_progress) {
      const age = Math.round(
        (Date.parse(`${data_date}T00:00:00Z`) - Date.parse(`${reportedAt}T00:00:00Z`)) / 86_400_000,
      );
      if (age > settings.progress_stale_days) stale_progress += 1;
    }

    const key = m.schedule_task_id ? `task:${m.schedule_task_id}` : `wbs:${m.wbs_item_id}`;
    const applied = applyOverride(progress.calculated_pct, overrides.get(key) ?? null);

    const pv = plannedValue({
      bac,
      baseline_start,
      baseline_finish,
      data_date,
      is_milestone: Boolean(task?.is_milestone),
    });
    const ev = applied.applied_pct === null ? null : sumMoney([bac * (applied.applied_pct / 100)]);

    const core: EvmCore = { bac, pv, ev, ac, bottom_up_etc };
    leaves.push({
      key: `${m.id}`,
      parent_key: m.wbs_item_id ?? task?.wbs_item_id ?? null,
      label,
      level: 2,
      wbs_item_id: m.wbs_item_id ?? task?.wbs_item_id ?? null,
      cost_code_id: m.cost_code_id,
      schedule_task_id: m.schedule_task_id,
      progress_method: m.progress_method,
      allocation_pct: m.allocation_pct,
      calculated_pct: applied.calculated_pct,
      applied_pct: applied.applied_pct,
      overridden: applied.overridden,
      core,
      measures: computeMeasures(core, eac_method),
    });
  }

  // --- unmapped scope: budget that carries no schedule link ----------------
  const unmapped_bac = sumMoney(
    workspace.cbs
      .filter((r) => !r.has_children && !mappedCostCodes.has(r.id))
      .map((r) => r.current),
  );

  const wbsParents = wbs.map((w) => ({
    key: w.id,
    parent_key: w.parent_id,
    label: `${w.code} ${w.name}`,
    level: 1,
    wbs_item_id: w.id,
    cost_code_id: null,
    schedule_task_id: null,
    progress_method: settings.default_progress_method,
    allocation_pct: 100,
  }));

  const nodes = rollUp(leaves, wbsParents, eac_method);
  const totalCore = sumCores(leaves.map((l) => l.core));
  const total = computeMeasures(totalCore, eac_method);
  const total_reporting = translateMeasures(total, fx);

  const { reconcileAllocations } = await import("@/lib/evm.report.rules");
  const quality = assessQuality(
    {
      unmapped_bac,
      total_bac: sumMoney([totalCore.bac, unmapped_bac]),
      allocation_issues: reconcileAllocations(mappings),
      missing_baseline_dates,
      missing_budget,
      stale_progress,
      future_dated_progress,
      missing_actuals,
      fx_missing: fx.missing ? [`${project_currency}>${reporting_currency}`] : [],
    },
    settings,
  );

  const baselineDates = leaves
    .map((l) => l.schedule_task_id && tasksById.get(l.schedule_task_id))
    .filter(Boolean) as TaskRow[];
  const starts = baselineDates.map((t) => t.start_date).filter(Boolean) as string[];
  const finishes = baselineDates.map((t) => t.end_date).filter(Boolean) as string[];

  return {
    project: { id: project.id, code: (project as { code?: string }).code ?? "", name: (project as { name?: string }).name ?? "" },
    period_month: period,
    data_date,
    project_currency,
    reporting_currency,
    fx,
    ac_basis,
    eac_method,
    cost_basis: "approved_budget",
    mapping_version_id: version?.id ?? null,
    schedule_baseline_id: input.schedule_baseline_id ?? null,
    nodes,
    total,
    total_reporting,
    delay_days: earnedDelayDays({
      percent_complete: total.percent_complete,
      baseline_start: starts.sort()[0] ?? null,
      baseline_finish: finishes.sort().at(-1) ?? null,
      data_date,
    }),
    quality,
    performance: performanceExceptions(total, settings),
    reconciliation: reconcile(leaves, totalCore),
    settings,
  };
}

async function resolveEvmFx(
  ctx: AuthContext,
  from: string,
  to: string,
  onDate: string,
): Promise<EvmFx> {
  if (from === to) {
    return { rate: 1, as_of: onDate, source: "parity", stale: false, missing: false };
  }
  const rate = await one<{ rate: number; as_of: string }>(
    sbOf(ctx)
      .from("fx_rates")
      .select("rate, as_of")
      .eq("base_code", from)
      .eq("quote_code", to)
      .lte("as_of", onDate)
      .order("as_of", { ascending: false })
      .order("source_priority", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );
  const res = resolveFx({
    txnCurrency: from,
    baseCurrency: to,
    onDate,
    tableRate: rate ? { rate: Number(rate.rate), as_of: rate.as_of } : null,
  });
  return {
    rate: res.rate,
    as_of: res.rate_date,
    source: res.source,
    stale: res.stale,
    missing: res.missing,
  };
}

// ---------------------------------------------------------------------------
// Snapshot lifecycle
// ---------------------------------------------------------------------------
export interface EvmReportRow {
  id: string;
  project_id: string;
  period_month: string;
  data_date: string;
  status: ReportStatus;
  version_no: number;
  row_version: number;
  reporting_currency: string;
  project_currency: string;
  ac_basis: AcBasis;
  official_eac_method: EacMethod;
  cost_basis: string;
  fx_provenance: Record<string, unknown>;
  totals: Record<string, unknown>;
  quality: Record<string, unknown>;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  correction_reason: string | null;
  prepared_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

async function logEvent(
  ctx: AuthContext,
  report: { id: string; company_id: string; project_id: string },
  event_type: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sbOf(ctx).from("evm_events").insert({
    company_id: report.company_id,
    project_id: report.project_id,
    report_id: report.id,
    event_type,
    actor_id: ctx.user?.id ?? null,
    from_status: (extra["from_status"] as string | null) ?? null,
    to_status: (extra["to_status"] as string | null) ?? null,
    reason: (extra["reason"] as string | null) ?? null,
    context: extra,
  });
  if (error && !isMissingObject(error)) throw error;
}

/** Persist (or refresh) the working snapshot for a period. */
export async function saveEvmReport(
  ctx: AuthContext,
  input: Parameters<typeof computeEvm>[1],
): Promise<{ report_id: string }> {
  await requireEvmWrite(ctx);
  const computed = await computeEvm(ctx, input);
  await assertPeriodOpenForEvm(ctx, input.project_id, computed.period_month);
  const project = await loadCostingProject(ctx, input.project_id);

  const existing = await one<EvmReportRow>(
    sbOf(ctx)
      .from("evm_reports")
      .select("*")
      .eq("project_id", input.project_id)
      .eq("period_month", computed.period_month)
      .neq("status", "superseded")
      .maybeSingle(),
  );
  if (existing && existing.status !== "working") {
    costingHttpError(409, "evm_report_frozen", "Withdraw or supersede the report before recalculating.");
  }

  const payload = {
    company_id: project.company_id,
    project_id: input.project_id,
    period_month: computed.period_month,
    data_date: computed.data_date,
    status: "working" as const,
    reporting_currency: computed.reporting_currency,
    project_currency: computed.project_currency,
    ac_basis: computed.ac_basis,
    official_eac_method: computed.eac_method,
    cost_basis: computed.cost_basis,
    mapping_version_id: computed.mapping_version_id,
    schedule_baseline_id: computed.schedule_baseline_id,
    fx_provenance: computed.fx as unknown as Record<string, unknown>,
    totals: {
      project: computed.total,
      reporting: computed.total_reporting,
      delay_days: computed.delay_days,
      reconciliation: computed.reconciliation,
    },
    quality: {
      unmapped_pct: computed.quality.unmapped_pct,
      blockers: computed.quality.blockers,
      warnings: computed.quality.warnings,
      ready_to_approve: computed.quality.ready_to_approve,
    },
    prepared_by: ctx.user?.id ?? null,
    prepared_at: new Date().toISOString(),
    created_by: ctx.user?.id ?? null,
  };

  const saved = existing
    ? await one<EvmReportRow>(
        sbOf(ctx).from("evm_reports").update(payload).eq("id", existing.id).select("*").single(),
      )
    : await one<EvmReportRow>(
        sbOf(ctx).from("evm_reports").insert(payload).select("*").single(),
      );
  if (!saved) costingHttpError(500, "evm_report_save_failed");

  // Freeze the line detail alongside the header.
  await sbOf(ctx).from("evm_report_lines").delete().eq("report_id", saved!.id);
  await sbOf(ctx).from("evm_exceptions").delete().eq("report_id", saved!.id);
  if (computed.nodes.length > 0) {
    const { error } = await sbOf(ctx)
      .from("evm_report_lines")
      .insert(
        computed.nodes.map((n, i) => ({
          company_id: project.company_id,
          report_id: saved!.id,
          wbs_item_id: n.wbs_item_id,
          cost_code_id: n.cost_code_id,
          schedule_task_id: n.schedule_task_id,
          label: n.label,
          level: n.level,
          progress_method: n.progress_method,
          allocation_pct: n.allocation_pct,
          calculated_pct: n.calculated_pct,
          applied_pct: n.applied_pct,
          bac: n.measures.bac,
          pv: n.measures.pv ?? 0,
          ev: n.measures.ev ?? 0,
          ac: n.measures.ac ?? 0,
          etc: n.measures.etc,
          eac: n.measures.eac,
          measures: n.measures,
          sort_order: i,
        })),
      );
    if (error) throw error;
  }
  const allExceptions = [...computed.quality.exceptions, ...computed.performance];
  if (allExceptions.length > 0) {
    await sbOf(ctx)
      .from("evm_exceptions")
      .insert(
        allExceptions.map((e) => ({
          company_id: project.company_id,
          project_id: input.project_id,
          report_id: saved!.id,
          period_month: computed.period_month,
          code: e.code,
          severity: e.severity,
          blocking: e.blocking,
          title: e.title,
          detail: e.detail,
          current_value: e.current_value,
          threshold_value: e.threshold_value,
          value_unit: e.value_unit,
          linked_ref: alertFingerprint({
            company_id: project.company_id,
            project_id: input.project_id,
            period_month: computed.period_month,
            code: e.code,
          }),
        })),
      );
  }

  await logEvent(
    ctx,
    { id: saved!.id, company_id: project.company_id, project_id: input.project_id },
    "calculated",
    { period_month: computed.period_month, data_date: computed.data_date, lines: computed.nodes.length },
  );
  await costingAudit(ctx, "evm.report.calculated", "evm_reports", saved!.id, {
    project_id: input.project_id,
    period_month: computed.period_month,
    blockers: computed.quality.blockers,
  });
  return { report_id: saved!.id };
}

export async function transitionEvmReport(
  ctx: AuthContext,
  input: { report_id: string; to: ReportStatus; reason?: string; row_version?: number },
): Promise<{ status: ReportStatus }> {
  await requireEvmWrite(ctx);
  const report = await one<EvmReportRow & { company_id: string }>(
    sbOf(ctx).from("evm_reports").select("*").eq("id", input.report_id).maybeSingle(),
  );
  if (!report) costingHttpError(404, "evm_report_not_found");
  if (input.row_version !== undefined && input.row_version !== report!.row_version) {
    costingHttpError(409, EVM_VERSION_CONFLICT, "The report changed since it was loaded.");
  }

  const locked = (await periodState(ctx, report!.project_id, report!.period_month)) === "hard_closed";
  const check = checkTransition({
    from: report!.status,
    to: input.to,
    actorId: ctx.user?.id ?? "",
    submittedBy: report!.submitted_by,
    gateReady: (report!.quality as { ready_to_approve?: boolean })?.ready_to_approve !== false,
    periodLocked: locked,
  });
  if (!check.ok) {
    costingHttpError(
      check.error === EVM_GATE_BLOCKED ? 422 : 409,
      check.error ?? "evm_invalid_transition",
    );
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.to };
  if (input.to === "submitted") {
    patch["submitted_by"] = ctx.user?.id ?? null;
    patch["submitted_at"] = now;
  }
  if (input.to === "approved") {
    patch["approved_by"] = ctx.user?.id ?? null;
    patch["approved_at"] = now;
  }
  if (input.to === "working") {
    patch["submitted_by"] = null;
    patch["submitted_at"] = null;
  }
  const { error } = await sbOf(ctx).from("evm_reports").update(patch).eq("id", input.report_id);
  if (error) throw error;

  await logEvent(ctx, report!, `status_${input.to}`, {
    from_status: report!.status,
    to_status: input.to,
    reason: input.reason ?? null,
  });
  await costingAudit(ctx, `evm.report.${input.to}`, "evm_reports", input.report_id, {
    project_id: report!.project_id,
    period_month: report!.period_month,
    from: report!.status,
    to: input.to,
  });
  return { status: input.to };
}

/** Corrections never edit an approved report; they create the next version. */
export async function supersedeEvmReport(
  ctx: AuthContext,
  input: { report_id: string; reason: string },
): Promise<{ report_id: string }> {
  await requireEvmWrite(ctx);
  const report = await one<EvmReportRow & { company_id: string }>(
    sbOf(ctx).from("evm_reports").select("*").eq("id", input.report_id).maybeSingle(),
  );
  if (!report) costingHttpError(404, "evm_report_not_found");
  const plan = supersedePlan({
    current: { id: report!.id, status: report!.status, version_no: report!.version_no },
    reason: input.reason,
  });
  if (!plan.ok) costingHttpError(409, plan.error ?? "evm_invalid_transition");

  const { error: supErr } = await sbOf(ctx)
    .from("evm_reports")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("id", report!.id);
  if (supErr) throw supErr;

  const created = await one<{ id: string }>(
    sbOf(ctx)
      .from("evm_reports")
      .insert({
        company_id: report!.company_id,
        project_id: report!.project_id,
        period_month: report!.period_month,
        data_date: report!.data_date,
        status: "working",
        version_no: plan.next_version_no,
        reporting_currency: report!.reporting_currency,
        project_currency: report!.project_currency,
        ac_basis: report!.ac_basis,
        official_eac_method: report!.official_eac_method,
        cost_basis: report!.cost_basis,
        supersedes_id: report!.id,
        correction_reason: input.reason,
        created_by: ctx.user?.id ?? null,
        prepared_by: ctx.user?.id ?? null,
      })
      .select("id")
      .single(),
  );
  if (created) {
    await sbOf(ctx).from("evm_reports").update({ superseded_by_id: created.id }).eq("id", report!.id);
    await logEvent(ctx, report!, "superseded", {
      from_status: "approved",
      to_status: "superseded",
      reason: input.reason,
      replacement_id: created.id,
    });
  }
  await costingAudit(ctx, "evm.report.superseded", "evm_reports", report!.id, {
    project_id: report!.project_id,
    period_month: report!.period_month,
    replacement_id: created?.id ?? null,
  });
  return { report_id: created?.id ?? report!.id };
}

// ---------------------------------------------------------------------------
// Project workspace payload
// ---------------------------------------------------------------------------
export interface EvmWorkspaceData {
  computed: EvmComputed;
  report: EvmReportRow | null;
  history: EvmReportRow[];
  trend: TrendPoint[];
  trend_analysis: ReturnType<typeof analyseTrend>;
  events: {
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    created_at: string;
  }[];
  period_state: string;
  can_write: boolean;
}

export async function loadEvmWorkspace(
  ctx: AuthContext,
  input: { project_id: string; period?: string; currency?: string },
): Promise<EvmWorkspaceData> {
  const computed = await computeEvm(ctx, input);
  const [history, state, can_write] = await Promise.all([
    rows<EvmReportRow>(
      sbOf(ctx)
        .from("evm_reports")
        .select("*")
        .eq("project_id", input.project_id)
        .order("period_month", { ascending: false })
        .order("version_no", { ascending: false })
        .limit(24),
    ),
    periodState(ctx, input.project_id, computed.period_month),
    hasAnyCostingRole(ctx, COSTING_WRITE_ROLES),
  ]);

  const report =
    history.find((h) => h.period_month === computed.period_month && h.status !== "superseded") ??
    null;

  const trend: TrendPoint[] = history
    .filter((h) => h.status === "approved" || h.status === "submitted")
    .map((h) => {
      const t = (h.totals as { project?: EvmMeasures })?.project;
      return {
        period_month: h.period_month,
        cpi: t?.cpi ?? null,
        spi: t?.spi ?? null,
        eac: t?.eac ?? null,
        ev: t?.ev ?? null,
        pv: t?.pv ?? null,
        ac: t?.ac ?? null,
      };
    });

  const events = report
    ? await rows<EvmWorkspaceData["events"][number]>(
        sbOf(ctx)
          .from("evm_events")
          .select("id, event_type, from_status, to_status, created_at")
          .eq("report_id", report.id)
          .order("created_at", { ascending: false })
          .limit(50),
      )
    : [];

  return {
    computed,
    report,
    history,
    trend,
    trend_analysis: analyseTrend(trend, computed.settings),
    events,
    period_state: state,
    can_write,
  };
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
export interface PortfolioEvmData {
  period: string;
  reporting_currency: string;
  rows: PortfolioEvmRow[];
  totals: ReturnType<typeof consolidateEvm>;
  quadrants: { quadrant: string; count: number }[];
  movers: ReturnType<typeof topAdverseMovers>;
  eac_methods: ReturnType<typeof eacMethodDistribution>;
  exception_aging: { bucket: string; count: number }[];
  mapping_completeness_pct: number | null;
}

export async function loadPortfolioEvm(
  ctx: AuthContext,
  filter: PortfolioEvmFilter,
): Promise<PortfolioEvmData> {
  const period = filter.period ?? currentReportingPeriod();
  const asOf = periodEndOf(period);

  // Set-based: one query for reports, one for projects, one for exceptions,
  // one for the prior period, one for rates.
  const reportsQ = sbOf(ctx)
    .from("evm_reports")
    .select(
      "id, project_id, period_month, status, reporting_currency, project_currency, official_eac_method, totals, quality, fx_provenance",
    )
    .eq("period_month", period)
    .neq("status", "superseded");
  const scoped = filter.project_id ? reportsQ.eq("project_id", filter.project_id) : reportsQ;
  const filtered = filter.status ? scoped.eq("status", filter.status) : scoped;

  const [reports, prior, projects, exceptions] = await Promise.all([
    rows<Record<string, unknown>>(filtered),
    rows<Record<string, unknown>>(
      sbOf(ctx)
        .from("evm_reports")
        .select("project_id, totals")
        .lt("period_month", period)
        .neq("status", "superseded")
        .order("period_month", { ascending: false }),
    ),
    rows<{ id: string; code: string; name: string }>(
      sbOf(ctx).from("projects").select("id, code, name"),
    ),
    rows<{ project_id: string; code: string; severity: string; created_at: string }>(
      sbOf(ctx)
        .from("evm_exceptions")
        .select("project_id, code, severity, created_at")
        .eq("period_month", period),
    ),
  ]);

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const priorByProject = new Map<string, EvmMeasures>();
  for (const p of prior) {
    const id = String(p["project_id"]);
    if (priorByProject.has(id)) continue;
    const t = (p["totals"] as { project?: EvmMeasures })?.project;
    if (t) priorByProject.set(id, t);
  }

  const currencies = [
    ...new Set(reports.map((r) => String(r["project_currency"] ?? "USD").toUpperCase())),
  ];
  const reporting_currency = (
    filter.currency ?? currencies[0] ?? "USD"
  ).toUpperCase();
  const fxByCurrency = new Map<string, EvmFx>();
  await Promise.all(
    currencies.map(async (c) => {
      fxByCurrency.set(c, await resolveEvmFx(ctx, c, reporting_currency, asOf));
    }),
  );

  const evmRows: PortfolioEvmRow[] = reports.map((r) => {
    const projectId = String(r["project_id"]);
    const currency = String(r["project_currency"] ?? "USD").toUpperCase();
    const measures =
      ((r["totals"] as { project?: EvmMeasures })?.project as EvmMeasures | undefined) ??
      computeMeasures({ bac: 0, pv: null, ev: null, ac: null, bottom_up_etc: null });
    const fx = fxByCurrency.get(currency) ?? {
      rate: null,
      as_of: null,
      source: null,
      stale: false,
      missing: true,
    };
    const quality = (r["quality"] ?? {}) as { blockers?: number; warnings?: number; unmapped_pct?: number };
    const priorM = priorByProject.get(projectId) ?? null;
    return {
      project_id: projectId,
      code: projectById.get(projectId)?.code ?? "",
      name: projectById.get(projectId)?.name ?? "",
      period_month: period,
      status: String(r["status"]) as ReportStatus,
      currency,
      project: measures,
      fx,
      reporting: translateMeasures(measures, fx),
      mapping_completeness_pct:
        quality.unmapped_pct === null || quality.unmapped_pct === undefined
          ? null
          : Math.max(0, 100 - quality.unmapped_pct),
      eac_method: String(r["official_eac_method"] ?? "bottom_up") as EacMethod,
      blockers: quality.blockers ?? 0,
      warnings: quality.warnings ?? 0,
      prior_cpi: priorM?.cpi ?? null,
      prior_spi: priorM?.spi ?? null,
    };
  });

  const settings = {
    cpi_threshold: 0.95,
    spi_threshold: 0.95,
    variance_threshold_pct: 5,
    variance_threshold_amount: 100_000,
    tcpi_feasibility_limit: 1.1,
  } satisfies PerformancePolicy;

  const quadrantCounts = new Map<string, number>();
  for (const r of evmRows) {
    const q = quadrantOf(r.project, settings);
    quadrantCounts.set(q, (quadrantCounts.get(q) ?? 0) + 1);
  }

  const completeness = evmRows
    .map((r) => r.mapping_completeness_pct)
    .filter((v): v is number => v !== null);

  const { exceptionAging } = await import("@/lib/evm.report.rules");
  return {
    period,
    reporting_currency,
    rows: evmRows.sort((a, b) => a.code.localeCompare(b.code)),
    totals: consolidateEvm(evmRows, reporting_currency),
    quadrants: [...quadrantCounts.entries()].map(([quadrant, count]) => ({ quadrant, count })),
    movers: topAdverseMovers(evmRows),
    eac_methods: eacMethodDistribution(evmRows),
    exception_aging: exceptionAging(
      exceptions.map((e) => ({ code: e.code as never, first_seen: e.created_at })),
      asOf,
    ),
    mapping_completeness_pct:
      completeness.length === 0
        ? null
        : Math.round((completeness.reduce((s, v) => s + v, 0) / completeness.length) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Exports and pack appendix
// ---------------------------------------------------------------------------
export async function loadEvmCsv(
  ctx: AuthContext,
  input: { project_id: string; period?: string; kind: "detail" | "trend" | "mappings" | "exceptions" | "formulas" },
): Promise<{ filename: string; csv: string }> {
  const data = await loadEvmWorkspace(ctx, input);
  const stamp = `${data.computed.period_month.slice(0, 7)}`;
  switch (input.kind) {
    case "trend":
      return { filename: `evm-trend-${stamp}.csv`, csv: buildTrendCsv(data.trend) };
    case "mappings": {
      const version = await activeMappingVersion(ctx, input.project_id);
      const mappings = version ? await listMappings(ctx, version.id) : [];
      return { filename: `evm-mappings-${stamp}.csv`, csv: buildMappingCsv(mappings) };
    }
    case "exceptions":
      return {
        filename: `evm-exceptions-${stamp}.csv`,
        csv: buildExceptionCsv([...data.computed.quality.exceptions, ...data.computed.performance]),
      };
    case "formulas":
      return {
        filename: `evm-formulas-${stamp}.csv`,
        csv: buildFormulaComparisonCsv(data.computed.total),
      };
    default:
      return { filename: `evm-detail-${stamp}.csv`, csv: buildDetailCsv(data.computed.nodes) };
  }
}

export async function loadEvmAppendix(
  ctx: AuthContext,
  input: { project_id: string; period?: string },
): Promise<EvmAppendix> {
  const data = await loadEvmWorkspace(ctx, input);
  const c = data.computed;
  return {
    period_month: c.period_month,
    data_date: c.data_date,
    status: data.report?.status ?? "working",
    basis: {
      cost_basis: c.cost_basis,
      ac_basis: c.ac_basis,
      eac_method: c.eac_method,
      schedule_baseline: c.schedule_baseline_id,
    },
    fx: {
      reporting_currency: c.reporting_currency,
      project_currency: c.project_currency,
      rate: c.fx.rate,
      as_of: c.fx.as_of,
      source: c.fx.source,
    },
    approvals: {
      prepared_by: data.report?.prepared_by ?? null,
      submitted_by: data.report?.submitted_by ?? null,
      approved_by: data.report?.approved_by ?? null,
      approved_at: data.report?.approved_at ?? null,
    },
    measures: c.total,
    quality_gaps: [...c.quality.exceptions, ...c.performance].map((e) => ({
      code: e.code,
      severity: e.severity,
      title: e.title,
    })),
    reconciliation: { ok: c.reconciliation.ok, difference: c.reconciliation.difference },
  };
}
