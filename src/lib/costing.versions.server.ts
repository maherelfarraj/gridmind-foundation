// GC-03 — Server-only forecast version lifecycle (create, refresh, transition).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  assertCostingPeriodOpen,
  buildSnapshotLines,
  loadCostingSettings,
  loadForecastVersion,
} from "@/lib/costing.close.server";
import { costingAudit, costingHttpError, loadCostingWorkspace } from "@/lib/costing.server";
import {
  canTransitionVersion,
  checkVersionApproval,
  nextVersionNumber,
  nextVersionStatus,
  snapshotTotals,
  FORECAST_INVALID_TRANSITION,
  FORECAST_VERSION_CONFLICT,
  type ForecastSnapshotLine,
  type ForecastVersionActionInput,
  type ForecastVersionStatus,
} from "@/lib/costing.versions";

interface ProjectRef {
  id: string;
  company_id: string;
  name: string;
  code: string;
}

function lineRows(
  lines: readonly ForecastSnapshotLine[],
  version: { id: string; company_id: string; project_id: string },
) {
  return lines.map((l) => ({
    company_id: version.company_id,
    project_id: version.project_id,
    version_id: version.id,
    cost_code_id: l.cost_code_id,
    cost_code_key: l.cost_code_key,
    cost_code: l.cost_code,
    cost_code_name: l.cost_code_name,
    currency_code: l.currency_code,
    base_currency_code: l.base_currency_code,
    fx_rate: l.fx_rate,
    fx_rate_date: l.fx_rate_date,
    fx_source: l.fx_source,
    fx_override_reason: l.fx_override_reason,
    etc_amount: l.etc_amount,
    etc_amount_base: l.etc_amount_base,
    budget_current: l.budget_current,
    committed: l.committed,
    actual: l.actual,
    accruals: l.accruals,
    eac: l.eac,
    vac: l.vac,
    provenance: {
      fx_source: l.fx_source,
      fx_rate_date: l.fx_rate_date,
      fx_override_reason: l.fx_override_reason,
    },
  }));
}

/** Create a Working version snapshotting the current live cost position. */
export async function createVersionFromLive(
  ctx: AuthContext,
  project: ProjectRef,
  period: string,
  label: string | null,
): Promise<{ id: string; version_no: number }> {
  const sb = ctx.supabase as any;
  const ws = await loadCostingWorkspace(ctx, project.id);
  const lines = buildSnapshotLines(ws, period);
  const totals = snapshotTotals(lines, ws.baseCurrency);

  const { data: existing, error: exErr } = await sb
    .from("forecast_versions")
    .select("version_no")
    .eq("project_id", project.id)
    .eq("reporting_period", period);
  if (exErr) throw exErr;
  const version_no = nextVersionNumber((existing ?? []) as { version_no: number }[]);

  const { data: header, error } = await sb
    .from("forecast_versions")
    .insert({
      company_id: project.company_id,
      project_id: project.id,
      reporting_period: period,
      version_no,
      status: "working",
      base_currency_code: ws.baseCurrency,
      label,
      totals,
      provenance: { fx_missing: ws.fxMissing, snapshot_at: new Date().toISOString() },
      created_by: (ctx as any).user?.id ?? null,
    })
    .select("id, version_no")
    .single();
  if (error) throw error;

  if (lines.length > 0) {
    const { error: lineErr } = await sb
      .from("forecast_version_lines")
      .insert(
        lineRows(lines, { id: header.id, company_id: project.company_id, project_id: project.id }),
      );
    if (lineErr) throw lineErr;
  }

  await costingAudit(ctx, "costing.forecast_version.create", "forecast_versions", header.id, {
    project_id: project.id,
    reporting_period: period,
    version_no,
    totals,
    line_count: lines.length,
  });
  return { id: header.id as string, version_no: Number(header.version_no) };
}

/** Re-snapshot a Working version from the live position. Working only. */
export async function refreshVersionSnapshot(
  ctx: AuthContext,
  versionId: string,
): Promise<{ lines: number }> {
  const sb = ctx.supabase as any;
  const version = await loadForecastVersion(ctx, versionId);
  if (version.status !== "working") {
    costingHttpError(
      409,
      FORECAST_INVALID_TRANSITION,
      `Only a working version can be refreshed (this one is ${version.status}).`,
    );
  }
  await assertCostingPeriodOpen(
    ctx,
    version.company_id,
    version.project_id,
    version.reporting_period,
    {
      entity: "forecast_versions",
      entityId: versionId,
    },
  );

  const ws = await loadCostingWorkspace(ctx, version.project_id);
  const lines = buildSnapshotLines(ws, version.reporting_period);
  const totals = snapshotTotals(lines, ws.baseCurrency);

  const { error: delErr } = await sb
    .from("forecast_version_lines")
    .delete()
    .eq("version_id", versionId);
  if (delErr) throw delErr;

  if (lines.length > 0) {
    const { error: insErr } = await sb.from("forecast_version_lines").insert(
      lineRows(lines, {
        id: versionId,
        company_id: version.company_id,
        project_id: version.project_id,
      }),
    );
    if (insErr) throw insErr;
  }

  const { error: upErr } = await sb
    .from("forecast_versions")
    .update({ totals, base_currency_code: ws.baseCurrency, row_version: version.row_version + 1 })
    .eq("id", versionId);
  if (upErr) throw upErr;

  await costingAudit(ctx, "costing.forecast_version.refresh", "forecast_versions", versionId, {
    project_id: version.project_id,
    reporting_period: version.reporting_period,
    totals,
    line_count: lines.length,
  });
  return { lines: lines.length };
}

/** Submit / recall / approve. Approval is atomic and supersedes in one step. */
export async function applyVersionAction(
  ctx: AuthContext,
  input: ForecastVersionActionInput,
): Promise<{ status: ForecastVersionStatus }> {
  const sb = ctx.supabase as any;
  const version = await loadForecastVersion(ctx, input.versionId);

  if (input.expectedRowVersion != null && input.expectedRowVersion !== version.row_version) {
    costingHttpError(
      409,
      FORECAST_VERSION_CONFLICT,
      `This version changed since you loaded it (expected v${input.expectedRowVersion}, found v${version.row_version}). Reload and try again.`,
    );
  }
  if (!canTransitionVersion(version.status, input.action)) {
    costingHttpError(
      409,
      FORECAST_INVALID_TRANSITION,
      `Cannot ${input.action} a ${version.status} forecast version.`,
    );
  }

  await assertCostingPeriodOpen(
    ctx,
    version.company_id,
    version.project_id,
    version.reporting_period,
    {
      entity: "forecast_versions",
      entityId: version.id,
    },
  );

  const userId = (ctx as any).user?.id ?? null;

  if (input.action === "submit") {
    // Freeze the snapshot at submission so reviewers see exactly what moves.
    await refreshVersionSnapshot(ctx, version.id);
    const { error } = await sb
      .from("forecast_versions")
      .update({
        status: "submitted",
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
        row_version: version.row_version + 2,
      })
      .eq("id", version.id);
    if (error) throw error;
    await costingAudit(ctx, "costing.forecast_version.submit", "forecast_versions", version.id, {
      project_id: version.project_id,
      reporting_period: version.reporting_period,
      version_no: version.version_no,
    });
    return { status: "submitted" };
  }

  if (input.action === "recall") {
    const { error } = await sb
      .from("forecast_versions")
      .update({
        status: "working",
        submitted_by: null,
        submitted_at: null,
        row_version: version.row_version + 1,
      })
      .eq("id", version.id);
    if (error) throw error;
    await costingAudit(ctx, "costing.forecast_version.recall", "forecast_versions", version.id, {
      project_id: version.project_id,
      reporting_period: version.reporting_period,
    });
    return { status: nextVersionStatus("recall") };
  }

  // --- approve -------------------------------------------------------------
  const settings = await loadCostingSettings(ctx, version.company_id);
  const { data: prior, error: priorErr } = await sb
    .from("forecast_versions")
    .select("id, totals")
    .eq("project_id", version.project_id)
    .eq("reporting_period", version.reporting_period)
    .eq("status", "approved")
    .maybeSingle();
  if (priorErr) throw priorErr;

  const previousEac = prior ? Number((prior.totals as { eac?: number })?.eac ?? 0) : null;
  const gate = checkVersionApproval({
    status: version.status,
    previousEac,
    nextEac: Number(version.totals?.eac ?? 0),
    policy: settings.materiality,
    explanation: input.explanation,
  });
  if (!gate.ok) costingHttpError(409, gate.code!, gate.message);

  if (input.explanation) {
    const { error } = await sb
      .from("forecast_versions")
      .update({ materiality_explanation: input.explanation.trim() })
      .eq("id", version.id);
    if (error) throw error;
  }

  const { error: rpcErr } = await sb.rpc("approve_forecast_version", {
    p_version_id: version.id,
    p_expected_row_version: null,
  });
  if (rpcErr) {
    costingHttpError(409, "forecast_approval_failed", rpcErr.message);
  }

  await costingAudit(ctx, "costing.forecast_version.approve", "forecast_versions", version.id, {
    project_id: version.project_id,
    reporting_period: version.reporting_period,
    version_no: version.version_no,
    superseded_version_id: prior?.id ?? null,
    previous_eac: previousEac,
    approved_eac: Number(version.totals?.eac ?? 0),
    material: Boolean(gate.material),
    delta: gate.delta ?? 0,
    explanation: input.explanation ?? null,
  });
  return { status: "approved" };
}
