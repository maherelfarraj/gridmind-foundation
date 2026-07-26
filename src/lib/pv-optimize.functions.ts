// P-163 — Layout optimization server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { canWritePvLayout, httpError, mapLayoutRpcError } from "@/lib/pv-layout.server";
import {
  auditOptimization,
  buildOptimizationContext,
  latestApprovalStatus,
  loadRun,
  nextRunRef,
  OPTIMIZATION_ENTITY,
  OPTIMIZATION_RULE_KEY,
  type OptimizationRunRow,
} from "@/lib/pv-optimize.server";
import { ringArea, type AlternativeParams } from "@/lib/pv/layout";
import {
  evaluateCandidate,
  OPTIMIZATION_METRICS,
  presetWeights,
  runLayoutOptimizationEngine,
  SCENARIO_TYPES,
  weightsAreValid,
  type OptimizationResults,
} from "@/lib/pv/optimize";

const weightsSchema = z
  .object({
    capacity: z.number().min(0).max(1),
    grading: z.number().min(0).max(1),
    cable_length: z.number().min(0).max(1),
    road_length: z.number().min(0).max(1),
    epc_cost: z.number().min(0).max(1),
    energy_yield: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => weightsAreValid(w), { message: "Weights must be non-negative and sum to 1." });

const constraintsSchema = z
  .object({
    maxSlopePct: z.number().min(0).max(60).default(8),
    maxGradingM3: z.number().min(0).nullable().default(null),
    minCapacityKwp: z.number().min(0).nullable().default(null),
    maxEpcCostUsd: z.number().min(0).nullable().default(null),
    requireCompliance: z.boolean().default(false),
  })
  .strict();

const runSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  scenarioType: z.enum(SCENARIO_TYPES),
  weights: weightsSchema.nullable().default(null),
  constraints: constraintsSchema.partial().default({}),
  surfaceId: z.string().uuid().nullable().default(null),
});

/** Lists every optimization run for a project, newest first. */
export const listLayoutOptimizationRuns = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ runs: OptimizationRunRow[]; canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("layout_optimization_runs")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return {
      runs: (rows ?? []) as unknown as OptimizationRunRow[],
      canWrite: await canWritePvLayout(context),
    };
  });

/**
 * Sweeps the parameter space and persists the scored candidate set.
 * Engine failures are recorded on the run itself (status `failed`) so a bad
 * run is never silently lost.
 */
export const runLayoutOptimization = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => runSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const weights = data.weights ?? presetWeights(data.scenarioType);
    const runRef = await nextRunRef(context, data.projectId);
    const constraints = constraintsSchema.parse({ ...data.constraints });
    const ctx = await buildOptimizationContext(context, data.projectId, data.surfaceId);

    const { data: created, error: insertError } = await context.supabase
      .from("layout_optimization_runs")
      .insert({
        company_id: ctx.companyId,
        project_id: data.projectId,
        run_ref: runRef,
        name: data.name,
        scenario_type: data.scenarioType,
        status: "running",
        surface_id: ctx.surfaceId,
        weights: weights as never,
        constraints: constraints as never,
        inputs: {
          base: ctx.base,
          costs: ctx.costs,
          yield_reference: ctx.yieldRef,
          site_config_id: ctx.siteConfigId,
          module_id: ctx.moduleId,
          sources: ctx.sources,
        } as never,
        created_by: (context as { user?: { id?: string } }).user?.id ?? null,
      } as never)
      .select("id")
      .single();
    if (insertError) throw insertError;
    const runId = (created as { id: string }).id;

    let results: OptimizationResults;
    try {
      results = runLayoutOptimizationEngine({
        site: ctx.site,
        base: ctx.base,
        costs: ctx.costs,
        yieldRef: ctx.yieldRef,
        constraints,
        weights,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown engine failure";
      await context.supabase
        .from("layout_optimization_runs")
        .update({ status: "failed", results: { error: message } as never } as never)
        .eq("id", runId);
      await auditOptimization(context, "layout.optimization_failed", runId, {
        project_id: data.projectId,
        error: message,
      });
      httpError(422, "optimization_failed", message);
    }

    const winner = results.candidates.find((c) => c.index === results.winner_index) ?? null;
    const { error: updateError } = await context.supabase
      .from("layout_optimization_runs")
      .update({
        status: "completed",
        results: results as never,
        chosen_candidate: winner?.index ?? null,
        score: winner?.score ?? null,
      } as never)
      .eq("id", runId);
    if (updateError) throw updateError;

    await auditOptimization(context, "layout.optimization_completed", runId, {
      project_id: data.projectId,
      run_ref: runRef,
      scenario_type: data.scenarioType,
      candidate_count: results.candidate_count,
      winner_index: results.winner_index,
      score: winner?.score ?? null,
    });

    return { runId, runRef, results };
  });

/** Chooses a candidate on a completed run before it goes for approval. */
export const chooseOptimizationCandidate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ runId: z.string().uuid(), candidateIndex: z.number().int().min(0) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");
    const run = await loadRun(context, data.runId);
    if (run.status === "approved" || run.status === "superseded") {
      httpError(409, "run_locked", "This run is locked; create a new revision instead.");
    }
    const results = run.results as unknown as OptimizationResults | null;
    const candidate = results?.candidates.find((c) => c.index === data.candidateIndex);
    if (!candidate) httpError(404, "candidate_not_found", "Candidate not found on this run.");

    const { error } = await context.supabase
      .from("layout_optimization_runs")
      .update({ chosen_candidate: candidate.index, score: candidate.score } as never)
      .eq("id", run.id);
    if (error) throw error;
    return { runId: run.id, candidateIndex: candidate.index, score: candidate.score };
  });

/** Starts the P-111 approval for the chosen scenario. */
export const submitOptimizationRun = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");
    const run = await loadRun(context, data.runId);
    if (run.status !== "completed" && run.status !== "under_review") {
      httpError(409, "invalid_status", "Only a completed run can be submitted for approval.");
    }
    if (run.chosen_candidate === null) {
      httpError(409, "no_candidate", "Choose a candidate before submitting for approval.");
    }

    await context.supabase.rpc("ensure_pv_layout_rule", { p_company_id: run.company_id });
    const { data: instanceId, error } = await context.supabase.rpc("start_approval_instance", {
      p_rule_key: OPTIMIZATION_RULE_KEY,
      p_entity_type: OPTIMIZATION_ENTITY,
      p_entity_id: run.id,
      p_metadata: {
        project_id: run.project_id,
        run_ref: run.run_ref,
        scenario_type: run.scenario_type,
        candidate: run.chosen_candidate,
      } as never,
    });
    if (error) throw error;

    const { error: updateError } = await context.supabase
      .from("layout_optimization_runs")
      .update({
        status: "under_review",
        approval_instance_id: (instanceId as string) ?? null,
      } as never)
      .eq("id", run.id);
    if (updateError) throw updateError;

    await auditOptimization(context, "layout.optimization_submitted", run.id, {
      project_id: run.project_id,
      approval_instance_id: instanceId,
    });
    return { runId: run.id, approvalInstanceId: (instanceId as string) ?? null };
  });

/** Latest approval status for a run (drives the Apply gate in the UI). */
export const getOptimizationApproval = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return { status: await latestApprovalStatus(context, data.runId) };
  });

/**
 * Hands the approved candidate to the Batch 17 layout writer.
 * Blocked until the P-111 instance is approved — the engine proposes, the
 * approval engine decides.
 */
export const applyOptimizationScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");
    const run = await loadRun(context, data.runId);
    if (run.chosen_candidate === null) httpError(409, "no_candidate", "No candidate chosen.");

    const approval = await latestApprovalStatus(context, run.id);
    if (approval !== "approved") {
      httpError(
        409,
        "approval_pending",
        "The scenario must be approved before it can be applied to the layout.",
      );
    }

    const results = run.results as unknown as OptimizationResults | null;
    const candidate = results?.candidates.find((c) => c.index === run.chosen_candidate);
    if (!candidate) httpError(409, "candidate_missing", "The chosen candidate is no longer stored.");

    const ctx = await buildOptimizationContext(context, run.project_id, run.surface_id);
    const rebuilt = evaluateCandidate(
      ctx.site,
      candidate.params as AlternativeParams,
      candidate.index,
      results!.costs,
      results!.yield_reference,
      results!.constraints,
      2,
    );
    const arranged = rebuilt.result;

    const { data: layoutRow, error: layoutError } = await context.supabase.rpc("create_pv_layout", {
      p_project_id: run.project_id,
      p_name: `${run.run_ref} · ${run.name}`,
      p_site_config_id: ctx.siteConfigId,
      p_params: {
        module_id: ctx.moduleId,
        structure_id: null,
        tracker_id: null,
        orientation: candidate.params.orientation,
        modules_across: candidate.params.modulesAcross,
        modules_up: candidate.params.modulesUp,
        tilt_deg: candidate.params.tracker ? 0 : candidate.params.tiltDeg,
        azimuth_deg: candidate.params.azimuthDeg,
        pitch_m: rebuilt.candidate.pitchM,
        row_spacing_m: Math.max(0, rebuilt.candidate.pitchM - 1),
        gcr: candidate.params.gcr,
        setback_m: candidate.params.setbackM,
        road_width_m: candidate.params.roadWidthM,
        corridor_width_m: 4,
        module_wp: candidate.params.moduleWp,
      } as never,
      p_totals: {
        module_count: arranged.metrics.moduleCount,
        table_count: arranged.metrics.tableCount,
        block_count: arranged.blocks.length,
        dc_kwp: arranged.metrics.dcKwp,
        used_area_m2: arranged.metrics.usedAreaM2,
        boundary_area_m2: arranged.metrics.boundaryAreaM2 || ringArea(ctx.site.boundary),
        compliance: {
          status: arranged.compliance.status,
          warnings: arranged.compliance.warningCount,
          failures: arranged.compliance.failureCount,
          optimization_run: run.run_ref,
        },
      } as never,
      p_blocks: arranged.blocks.map((b, i) => ({
        block_type: b.type,
        label: b.label,
        geometry: {
          polygon: b.polygon.map((p) => [p.x, p.y]),
          rotation_deg: candidate.params.azimuthDeg,
        },
        equipment_id: b.type === "array_table" ? ctx.moduleId : null,
        module_rows: b.type === "array_table" ? candidate.params.modulesUp : null,
        modules_per_row: b.type === "array_table" ? candidate.params.modulesAcross : null,
        module_count: b.moduleCount,
        dc_kwp: b.dcKwp,
        sort_order: i,
      })) as never,
    } as never);
    if (layoutError) mapLayoutRpcError(layoutError as never);
    const layoutId = (layoutRow as { id?: string } | null)?.id ?? null;

    const { error: statusError } = await context.supabase
      .from("layout_optimization_runs")
      .update({ status: "approved", score: candidate.score } as never)
      .eq("id", run.id);
    if (statusError) throw statusError;

    await auditOptimization(context, "layout.scenario_applied", run.id, {
      project_id: run.project_id,
      run_ref: run.run_ref,
      candidate_index: candidate.index,
      layout_id: layoutId,
      dc_kwp: arranged.metrics.dcKwp,
      metrics: OPTIMIZATION_METRICS.reduce<Record<string, number>>((acc, m) => {
        acc[m] = candidate.metrics[m];
        return acc;
      }, {}),
    });

    return { runId: run.id, layoutId, blockCount: arranged.blocks.length };
  });
